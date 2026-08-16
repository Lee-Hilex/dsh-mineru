/**
 * MinerU API client: 精准解析 API (v4, token) and Agent 轻量解析 API (v1, no
 * token), with client-side rate limiting, 429 handling, polling, result
 * download, and zip extraction.
 *
 * Official limits honored by default (see docs):
 *  - submissions: 50 files/min shared across submit endpoints; 5000 files/day
 *    per user (max 100 HTML files/day)
 *  - result queries: 1000/min
 *  - precision: <= 200 MB, <= 200 pages, batch <= 200 urls / 50 upload links
 *  - agent: <= 10 MB, <= 20 pages, single file, Markdown-only output
 * @module dsh-mineru/mineru-client
 */
import { extname, join } from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { extractZip, readZipEntryText } from './zip.js';
import { AGENT_UNSUPPORTED_EXTENSIONS, MODEL_VERSION_VALUES, SUPPORTED_EXTENSIONS } from './config.js';

export class MineruError extends Error {
  /**
   * @param {string} message user-facing message
   * @param {string} code stable machine code
   * @param {{httpStatus?: number, taskId?: string, api?: string, rawCode?: string|number}} [info]
   */
  constructor(message, code = 'MINERU_ERROR', info = {}) {
    super(message);
    this.name = 'MineruError';
    this.code = code;
    this.httpStatus = info.httpStatus;
    this.taskId = info.taskId;
    this.api = info.api;
    this.rawCode = info.rawCode;
  }
}

const PRECISION_FILE_LIMIT = 200 * 1024 * 1024;
const AGENT_FILE_LIMIT = 10 * 1024 * 1024;

/** Map MinerU error codes to actionable messages. */
const ERROR_MESSAGES = Object.freeze({
  A0202: 'MinerU Token 错误：请检查 Token 是否正确（Bearer 前缀由插件自动添加），或更换新 Token。',
  A0211: 'MinerU Token 已过期：请更换新 Token。',
  '-500': 'MinerU 传参错误：请检查参数类型及 Content-Type。',
  '-10001': 'MinerU 服务异常，请稍后再试。',
  '-10002': 'MinerU 请求参数错误：请检查请求参数格式。',
  '-60001': 'MinerU 生成上传 URL 失败，请稍后再试。',
  '-60002': 'MinerU 无法识别文件类型：请确认文件名带有正确的后缀（pdf/doc/docx/ppt/pptx/xls/xlsx/png/jpg/jpeg 等）。',
  '-60003': 'MinerU 文件读取失败：请检查文件是否损坏并重新上传。',
  '-60004': 'MinerU 收到空文件：请上传有效文件。',
  '-60005': '文件大小超出限制：精准解析 API 最大支持 200MB，Agent 轻量解析 API 最大 10MB。',
  '-60006': '文件页数超过限制：精准解析 API 最大 200 页，Agent 轻量解析 API 最大 20 页，请拆分文件或使用 page_ranges。',
  '-60007': 'MinerU 模型服务暂时不可用，请稍后重试。',
  '-60008': 'MinerU 文件读取超时：请检查 URL 是否可访问。',
  '-60009': 'MinerU 任务提交队列已满，请稍后再试。',
  '-60010': 'MinerU 解析失败，请稍后再试。',
  '-60011': 'MinerU 获取有效文件失败：请确保文件已上传。',
  '-60012': 'MinerU 找不到任务：请确认 task_id 有效且未删除。',
  '-60013': 'MinerU 没有权限访问该任务：只能访问自己提交的任务。',
  '-60015': 'MinerU 文件转换失败：可以手动转为 PDF 再上传。',
  '-60016': 'MinerU 文件转换失败：可以尝试其他导出格式或重试。',
  '-60018': 'MinerU 每日解析任务数量已达上限，请明日再试。',
  '-60019': 'MinerU HTML 文件解析额度不足，请明日再试。',
  '-60020': 'MinerU 文件拆分失败，请稍后重试。',
  '-60022': 'MinerU 网页读取失败：可能因网络问题或限频导致，请稍后重试。',
  '-30001': '文件大小超出 Agent 轻量解析接口限制（10MB）：请改用精准解析 API（填写 Token）或拆分文件。',
  '-30002': 'Agent 轻量解析接口不支持该文件类型：请上传 PDF/图片/Docx/PPTx/Xlsx。',
  '-30003': '文件页数超出 Agent 轻量解析接口限制（20 页）：请改用精准解析 API 或指定 page_range。',
  '-30004': 'MinerU Agent 接口请求参数错误：请检查必填参数。',
});

/** @param {string|number|undefined} code @returns {string|undefined} */
function messageForCode(code) {
  if (code === undefined || code === null) return undefined;
  return ERROR_MESSAGES[String(code)];
}

/**
 * Abortable sleep.
 * @param {number} ms
 * @param {AbortSignal} [signal]
 */
function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(abortError()); return; }
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortError() {
  const err = new Error('operation aborted');
  err.name = 'AbortError';
  return err;
}

/** Simple client-side token bucket shared across concurrent calls. */
export class RateLimiter {
  /**
   * @param {number} perMinute tokens refilled per minute
   * @param {{burst?: number}} [opts]
   */
  constructor(perMinute, opts = {}) {
    this.rate = perMinute / 60000; // tokens per ms
    this.capacity = Math.max(1, opts.burst ?? Math.ceil(perMinute / 5));
    this.tokens = this.capacity;
    this.updatedAt = Date.now();
  }

  /**
   * Take one token, waiting if the bucket is empty.
   * @param {AbortSignal} [signal]
   */
  async acquire(signal) {
    for (;;) {
      this.refill();
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const waitMs = Math.ceil((1 - this.tokens) / this.rate);
      await sleep(Math.min(waitMs, 5000), signal);
    }
  }

  refill() {
    const now = Date.now();
    const delta = now - this.updatedAt;
    if (delta > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + delta * this.rate);
      this.updatedAt = now;
    }
  }
}

/** Best-effort daily submission counter (the API is authoritative). */
export class DailyCounter {
  /**
   * @param {number} limit daily submission cap
   */
  constructor(limit) {
    this.limit = limit;
    this.day = '';
    this.count = 0;
  }

  /**
   * @param {number} n files about to be submitted
   */
  add(n) {
    const day = new Date().toISOString().slice(0, 10);
    if (day !== this.day) { this.day = day; this.count = 0; }
    this.count += n;
    if (this.count > this.limit) {
      throw new MineruError(
        '已达本地每日提交上限 ' + this.limit + ' 个文件（MinerU 官方限制 5000 个/天，其中 html 最多 100 个），请明日再试。',
        'MINERU_DAILY_LIMIT',
      );
    }
  }
}

function sanitizeDataId(value) {
  const v = String(value ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 128);
  return v || undefined;
}

function normalizeBaseUrl(base) {
  return String(base ?? '').trim().replace(/\/+$/, '');
}

/** @param {string} p */
function extOf(p) {
  return extname(p).toLowerCase();
}

function mergeHeaders(base, extra) {
  return { ...(base ?? {}), ...(extra ?? {}) };
}

/** @param {object} item @param {number} index @param {object} opts */
function dataIdFor(item, index, opts) {
  return sanitizeDataId(item.dataId ?? (opts.dataIdPrefix ? opts.dataIdPrefix + '-' + (index + 1) : undefined));
}/** One HTTP request with JSON decoding. 429 throws a retryable MineruError. */
async function requestJson({ url, method = 'GET', headers = {}, body, signal, timeoutMs = 60000, userAgent }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: { 'User-Agent': userAgent ?? 'dsh-mineru', ...headers },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      if (signal?.aborted) throw abortError();
      throw new MineruError('MinerU 请求超时（' + timeoutMs + 'ms）：请稍后重试或增大 timeoutMs。', 'MINERU_TIMEOUT');
    }
    throw new MineruError('无法连接 MinerU API：' + (err?.message ?? String(err)), 'MINERU_NETWORK');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
  const text = await res.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { /* non-JSON body */ }
  }
  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('retry-after')) || 30;
    const err = new MineruError('MinerU 接口限频（HTTP 429）：官方限制 50 个文件/分钟提交、1000 次/分钟查询，请降低并发或稍后重试。', 'MINERU_RATE_LIMITED', { httpStatus: 429 });
    err.retryAfterSec = Math.min(120, retryAfter);
    throw err;
  }
  if (res.status === 401 || res.status === 403) {
    throw new MineruError('MinerU Token 校验失败（HTTP ' + res.status + '）：请在设置中更新 Token。', 'MINERU_TOKEN_INVALID', { httpStatus: res.status });
  }
  if (!res.ok) {
    throw new MineruError('MinerU 请求失败（HTTP ' + res.status + '）：' + String(payload?.msg || text).slice(0, 400), 'MINERU_HTTP', { httpStatus: res.status });
  }
  return { status: res.status, payload, headers: res.headers };
}

async function requestJsonWithRetry(args) {
  try {
    return await requestJson(args);
  } catch (err) {
    if (err instanceof MineruError && err.code === 'MINERU_RATE_LIMITED' && (args.retries ?? 0) < 2) {
      await sleep(err.retryAfterSec * 1000, args.signal);
      return requestJsonWithRetry({ ...args, retries: (args.retries ?? 0) + 1 });
    }
    throw err;
  }
}

/** Upload one local file to a signed OSS URL (PUT, no auth). */
async function uploadToSignedUrl(filePath, uploadUrl, { signal, timeoutMs, userAgent }) {
  const size = (await stat(filePath)).size;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 60000));
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const body = Readable.toWeb(createReadStream(filePath));
    const res = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'User-Agent': userAgent ?? 'dsh-mineru', 'Content-Length': String(size) },
      body,
      // undici requires the duplex option for stream bodies
      duplex: 'half',
      signal: controller.signal,
    });
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
      const text = await res.text().catch(() => '');
      throw new MineruError('MinerU OSS 文件上传失败（HTTP ' + res.status + '）：' + text.slice(0, 300), 'MINERU_UPLOAD_FAILED');
    }
  } catch (err) {
    if (err instanceof MineruError) throw err;
    if (err?.name === 'AbortError') {
      if (signal?.aborted) throw abortError();
      throw new MineruError('MinerU 文件上传超时', 'MINERU_TIMEOUT');
    }
    throw new MineruError('MinerU 文件上传失败：' + (err?.message ?? String(err)), 'MINERU_UPLOAD_FAILED');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Download a URL to a local file (result zips / markdown). */
async function downloadTo(url, destPath, { signal, timeoutMs, userAgent, maxBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(timeoutMs, 120000));
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let size = 0;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent ?? 'dsh-mineru' },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok || !res.body) {
      throw new MineruError('MinerU 结果下载失败（HTTP ' + res.status + '）', 'MINERU_DOWNLOAD_FAILED');
    }
    const reader = res.body.getReader();
    const stream = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) { this.push(null); return; }
        size += value.byteLength;
        if (maxBytes && size > maxBytes) {
          this.destroy(new MineruError('MinerU 结果超过下载上限 ' + maxBytes + ' 字节', 'MINERU_TOO_LARGE'));
          return;
        }
        this.push(Buffer.from(value));
      },
    });
    await pipeline(stream, createWriteStream(destPath));
    return size;
  } catch (err) {
    await rm(destPath, { force: true }).catch(() => {});
    if (err instanceof MineruError) throw err;
    if (err?.name === 'AbortError') {
      if (signal?.aborted) throw abortError();
      throw new MineruError('MinerU 结果下载超时', 'MINERU_TIMEOUT');
    }
    throw new MineruError('MinerU 结果下载失败：' + (err?.message ?? String(err)), 'MINERU_DOWNLOAD_FAILED');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}/**
 * The Mineru client. Create one per API base + token; rate limiters and the
 * daily counter are shared so concurrent tool calls stay under the official
 * frequency caps.
 */
export class MineruClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl
   * @param {string} [opts.token] precision-API token; absent selects the agent API
   * @param {object} [opts.limiters] { submit: RateLimiter, poll: RateLimiter, daily: DailyCounter }
   * @param {string} [opts.userAgent]
   */
  constructor(opts) {
    this.baseUrl = normalizeBaseUrl(opts.baseUrl);
    this.token = opts.token ?? '';
    this.submit = opts.limiters?.submit ?? new RateLimiter(40);
    this.poll = opts.limiters?.poll ?? new RateLimiter(900);
    this.daily = opts.limiters?.daily ?? new DailyCounter(5000);
    this.userAgent = opts.userAgent ?? 'dsh-mineru';
    this.tmpFiles = [];
  }

  authHeaders() {
    return this.token ? { Authorization: 'Bearer ' + this.token } : {};
  }

  precisionEnabled() { return Boolean(this.token); }

  /** Register a temp file for cleanup on dispose. */
  trackTmp(path) { this.tmpFiles.push(path); }

  /**
   * Resolve which API serves one call.
   * @param {string} [modeArg] auto | precision | agent (per-call override)
   * @param {string} [cfgMode] auto | precision | agent (config default)
   * @returns {{api:'precision'|'agent', effectiveMode:string}}
   */
  resolveApi(modeArg, cfgMode) {
    const requested = modeArg ?? cfgMode ?? 'auto';
    if (requested === 'precision') {
      if (!this.precisionEnabled()) {
        throw new MineruError(
          'mode=precision 需要 MinerU Token：请在 Web 设置中填写 Token，或在 $DSH_HOME/.credentials.yaml 中配置 MINERU_API_TOKEN。',
          'MINERU_TOKEN_REQUIRED',
        );
      }
      return { api: 'precision', effectiveMode: 'precision' };
    }
    if (requested === 'agent') return { api: 'agent', effectiveMode: 'agent' };
    return this.precisionEnabled()
      ? { api: 'precision', effectiveMode: 'precision' }
      : { api: 'agent', effectiveMode: 'agent' };
  }

  /**
   * Validate a local file before upload.
   * @param {string} filePath
   * @param {'precision'|'agent'} api
   * @param {number} maxFileBytes config cap (0 = API limit)
   */
  async checkLocalFile(filePath, api, maxFileBytes) {
    let st;
    try { st = await stat(filePath); } catch {
      throw new MineruError('找不到文件：' + filePath, 'MINERU_FILE_NOT_FOUND');
    }
    if (!st.isFile()) throw new MineruError('不是常规文件：' + filePath, 'MINERU_FILE_NOT_FOUND');
    const ext = extOf(filePath);
    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      throw new MineruError(
        '不支持的文件类型 ' + (ext || '(无后缀)') + '：支持 pdf/doc/docx/ppt/pptx/xls/xlsx 与 png/jpg/jpeg/jp2/webp/gif/bmp' + (api === 'precision' ? '/html' : '') + '。',
        'MINERU_UNSUPPORTED_TYPE',
      );
    }
    if (api === 'agent' && AGENT_UNSUPPORTED_EXTENSIONS.includes(ext)) {
      throw new MineruError('Agent 轻量解析 API 不支持 ' + ext + ' 文件：请改用精准解析 API（填写 Token）。', 'MINERU_UNSUPPORTED_TYPE');
    }
    const limit = maxFileBytes > 0 ? maxFileBytes : (api === 'precision' ? PRECISION_FILE_LIMIT : AGENT_FILE_LIMIT);
    if (st.size > limit) {
      throw new MineruError(
        '文件过大：' + st.size + ' 字节，超出 ' + (api === 'precision' ? '精准解析 API 200MB' : 'Agent 轻量解析 API 10MB') + ' 限制。',
        'MINERU_FILE_TOO_LARGE',
      );
    }
    if (st.size === 0) throw new MineruError('文件为空：' + filePath, 'MINERU_EMPTY_FILE');
    return { size: st.size, ext };
  }

  /** Common precision request body for URL submissions. */
  precisionUrlBody(opts, url) {
    const body = {
      url,
      model_version: opts.modelVersion,
      is_ocr: opts.isOcr,
      enable_formula: opts.enableFormula,
      enable_table: opts.enableTable,
      language: opts.language,
    };
    if (opts.dataId) body.data_id = opts.dataId;
    if (opts.pageRanges) body.page_ranges = opts.pageRanges;
    if (opts.extraFormats?.length) body.extra_formats = opts.extraFormats;
    body.no_cache = true;
    return body;
  }

  agentUrlBody(opts, url) {
    const body = {
      url,
      language: opts.language,
      enable_table: opts.enableTable,
      is_ocr: opts.isOcr,
      enable_formula: opts.enableFormula,
    };
    if (opts.pageRange) body.page_range = opts.pageRange;
    return body;
  }

  agentFileBody(opts, fileName) {
    const body = {
      file_name: fileName,
      language: opts.language,
      enable_table: opts.enableTable,
      is_ocr: opts.isOcr,
      enable_formula: opts.enableFormula,
    };
    if (opts.pageRange) body.page_range = opts.pageRange;
    return body;
  }

  /**
   * @param {object} payload
   * @param {'precision'|'agent'} api
   */
  parsePayloadError(payload, api) {
    if (payload && typeof payload === 'object') {
      const code = payload.code;
      const data = payload.data;
      if (code !== undefined && code !== 0 && code !== '0') {
        const mapped = messageForCode(code) ?? (data?.err_code !== undefined ? messageForCode(data.err_code) : undefined);
        return new MineruError(mapped ?? ('MinerU 接口错误：' + (payload.msg || String(code))), 'MINERU_API', { rawCode: String(code), api });
      }
      if (data && typeof data === 'object' && data.err_code !== undefined) {
        const mapped = messageForCode(data.err_code);
        if (mapped) return new MineruError(mapped, 'MINERU_API', { rawCode: String(data.err_code), api });
      }
    }
    return new MineruError('MinerU 返回异常：' + String(payload ?? '').slice(0, 400), 'MINERU_API', { api });
  }

  /** Submit one URL and wait until done/failed. */
  async submitAndWaitUrl({ url, fileName, opts, api, signal, onState }) {
    await this.submit.acquire(signal);
    this.daily.add(1);
    let taskId;
    if (api === 'precision') {
      const { payload } = await requestJsonWithRetry({
        url: this.baseUrl + '/api/v4/extract/task',
        method: 'POST',
        headers: mergeHeaders({ 'Content-Type': 'application/json' }, this.authHeaders()),
        body: JSON.stringify(this.precisionUrlBody(opts, url)),
        signal, timeoutMs: 60000, userAgent: this.userAgent,
      });
      if (!payload || payload.code !== 0 || !payload.data?.task_id) {
        throw this.parsePayloadError(payload, api);
      }
      taskId = payload.data.task_id;
      onState?.({ phase: 'submitted', taskId });
    } else {
      const body = this.agentUrlBody(opts, url);
      if (fileName) body.file_name = fileName;
      const { payload } = await requestJsonWithRetry({
        url: this.baseUrl + '/api/v1/agent/parse/url',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal, timeoutMs: 60000, userAgent: this.userAgent,
      });
      if (!payload || payload.code !== 0 || !payload.data?.task_id) {
        throw this.parsePayloadError(payload, api);
      }
      taskId = payload.data.task_id;
      onState?.({ phase: 'submitted', taskId });
    }
    return this.waitTask({ taskId, api, opts, signal, onState });
  }  /** Upload one local file (signature upload) and wait until done/failed. */
  async submitAndWaitFile({ filePath, fileName, opts, api, signal, onState }) {
    await this.submit.acquire(signal);
    this.daily.add(1);
    if (api === 'precision') {
      const body = {
        files: [{
          name: fileName,
          ...(opts.dataId ? { data_id: opts.dataId } : {}),
          ...(opts.isOcr !== undefined ? { is_ocr: opts.isOcr } : {}),
          ...(opts.pageRanges ? { page_ranges: opts.pageRanges } : {}),
        }],
        model_version: opts.modelVersion,
        enable_formula: opts.enableFormula,
        enable_table: opts.enableTable,
        language: opts.language,
      };
      if (opts.extraFormats?.length) body.extra_formats = opts.extraFormats;
      const { payload } = await requestJsonWithRetry({
        url: this.baseUrl + '/api/v4/file-urls/batch',
        method: 'POST',
        headers: mergeHeaders({ 'Content-Type': 'application/json' }, this.authHeaders()),
        body: JSON.stringify(body),
        signal, timeoutMs: 60000, userAgent: this.userAgent,
      });
      if (!payload || payload.code !== 0 || !payload.data?.batch_id || !payload.data?.file_urls?.[0]) {
        throw this.parsePayloadError(payload, api);
      }
      const batchId = payload.data.batch_id;
      const uploadUrl = payload.data.file_urls[0];
      onState?.({ phase: 'uploading', batchId });
      await uploadToSignedUrl(filePath, uploadUrl, { signal, timeoutMs: opts.timeoutMs, userAgent: this.userAgent });
      onState?.({ phase: 'uploaded', batchId });
      const items = await this.waitBatch({ batchId, api, opts, signal, onState });
      const item = items[0];
      if (!item) throw new MineruError('MinerU 批量结果为空', 'MINERU_API', { api });
      return {
        api, taskId: item.taskId, batchId, state: item.state,
        fullZipUrl: item.fullZipUrl, errMsg: item.errMsg, progress: item.progress,
      };
    }
    const body = this.agentFileBody(opts, fileName);
    const { payload } = await requestJsonWithRetry({
      url: this.baseUrl + '/api/v1/agent/parse/file',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal, timeoutMs: 60000, userAgent: this.userAgent,
    });
    if (!payload || payload.code !== 0 || !payload.data?.task_id || !payload.data?.file_url) {
      throw this.parsePayloadError(payload, api);
    }
    const taskId = payload.data.task_id;
    const uploadUrl = payload.data.file_url;
    onState?.({ phase: 'uploading', taskId });
    await uploadToSignedUrl(filePath, uploadUrl, { signal, timeoutMs: opts.timeoutMs, userAgent: this.userAgent });
    onState?.({ phase: 'uploaded', taskId });
    return this.waitTask({ taskId, api, opts, signal, onState });
  }

  /** Query one task (agent or precision single). */
  async queryTask({ taskId, api, signal }) {
    await this.poll.acquire(signal);
    if (api === 'precision') {
      const { payload } = await requestJsonWithRetry({
        url: this.baseUrl + '/api/v4/extract/task/' + encodeURIComponent(taskId),
        headers: this.authHeaders(),
        signal, timeoutMs: 60000, userAgent: this.userAgent,
      });
      if (!payload || payload.code !== 0) throw this.parsePayloadError(payload, api);
      const d = payload.data ?? {};
      return {
        taskId: d.task_id ?? taskId,
        state: d.state ?? 'unknown',
        fullZipUrl: d.full_zip_url,
        errMsg: d.err_msg,
        progress: d.extract_progress,
      };
    }
    const { payload } = await requestJsonWithRetry({
      url: this.baseUrl + '/api/v1/agent/parse/' + encodeURIComponent(taskId),
      signal, timeoutMs: 60000, userAgent: this.userAgent,
    });
    if (!payload || payload.code !== 0) throw this.parsePayloadError(payload, api);
    const d = payload.data ?? {};
    return {
      taskId: d.task_id ?? taskId,
      state: d.state ?? 'unknown',
      markdownUrl: d.markdown_url,
      errMsg: d.err_msg,
      errCode: d.err_code,
    };
  }

  /** Wait for one task: poll until done/failed/timeout. */
  async waitTask({ taskId, api, opts, signal, onState }) {
    const started = Date.now();
    const deadline = started + (opts.timeoutMs ?? 600000);
    for (;;) {
      if (Date.now() > deadline) {
        throw new MineruError(
          'MinerU 任务等待超时（' + (opts.timeoutMs ?? 600000) + 'ms）。任务仍在服务端处理，可稍后用 mineru_task 以 taskId=' + taskId + '（api=' + api + '）继续收集结果。',
          'MINERU_TIMEOUT', { taskId, api },
        );
      }
      const last = await this.queryTask({ taskId, api, signal });
      if (last.state === 'done') {
        onState?.({ phase: 'done', taskId, state: last });
        return { api, taskId, state: 'done', fullZipUrl: last.fullZipUrl, markdownUrl: last.markdownUrl, errMsg: last.errMsg, progress: last.progress };
      }
      if (last.state === 'failed') {
        throw new MineruError(
          last.errMsg ?? 'MinerU 解析失败',
          'MINERU_PARSE_FAILED', { taskId, api },
        );
      }
      onState?.({ phase: 'waiting', taskId, state: last });
      await sleep(opts.pollIntervalMs + Math.floor(Math.random() * (opts.pollJitterMs + 1)), signal);
    }
  }  /** Submit a URL batch (precision only) and wait for every item. */
  async submitAndWaitBatchUrls({ items, opts, signal, onState }) {
    if (items.length > 200) throw new MineruError('精准解析 API 批量 URL 解析单次最多 200 个文件。', 'MINERU_BATCH_TOO_LARGE');
    await this.submit.acquire(signal);
    this.daily.add(items.length);
    const body = {
      files: items.map((it, i) => {
        const dataId = dataIdFor(it, i, opts);
        return {
          url: it.url,
          ...(dataId ? { data_id: dataId } : {}),
          ...(opts.isOcr !== undefined ? { is_ocr: opts.isOcr } : {}),
          ...(opts.pageRanges ? { page_ranges: opts.pageRanges } : {}),
        };
      }),
      model_version: opts.modelVersion,
      enable_formula: opts.enableFormula,
      enable_table: opts.enableTable,
      language: opts.language,
    };
    if (opts.extraFormats?.length) body.extra_formats = opts.extraFormats;
    const { payload } = await requestJsonWithRetry({
      url: this.baseUrl + '/api/v4/extract/task/batch',
      method: 'POST',
      headers: mergeHeaders({ 'Content-Type': 'application/json' }, this.authHeaders()),
      body: JSON.stringify(body),
      signal, timeoutMs: 60000, userAgent: this.userAgent,
    });
    if (!payload || payload.code !== 0 || !payload.data?.batch_id) throw this.parsePayloadError(payload, 'precision');
    const batchId = payload.data.batch_id;
    onState?.({ phase: 'submitted', batchId });
    const results = await this.waitBatch({ batchId, api: 'precision', opts, signal, onState });
    return { api: 'precision', batchId, results };
  }

  /** Submit a local-file batch (precision only) and wait for every item. */
  async submitAndWaitBatchFiles({ items, opts, signal, onState }) {
    if (items.length > 50) throw new MineruError('精准解析 API 本地批量上传单次最多申请 50 个上传链接。', 'MINERU_BATCH_TOO_LARGE');
    await this.submit.acquire(signal);
    this.daily.add(items.length);
    const body = {
      files: items.map((it, i) => {
        const dataId = dataIdFor(it, i, opts);
        return {
          name: it.fileName,
          ...(dataId ? { data_id: dataId } : {}),
          ...(opts.isOcr !== undefined ? { is_ocr: opts.isOcr } : {}),
          ...(opts.pageRanges ? { page_ranges: opts.pageRanges } : {}),
        };
      }),
      model_version: opts.modelVersion,
      enable_formula: opts.enableFormula,
      enable_table: opts.enableTable,
      language: opts.language,
    };
    if (opts.extraFormats?.length) body.extra_formats = opts.extraFormats;
    const { payload } = await requestJsonWithRetry({
      url: this.baseUrl + '/api/v4/file-urls/batch',
      method: 'POST',
      headers: mergeHeaders({ 'Content-Type': 'application/json' }, this.authHeaders()),
      body: JSON.stringify(body),
      signal, timeoutMs: 60000, userAgent: this.userAgent,
    });
    if (!payload || payload.code !== 0 || !payload.data?.batch_id || !Array.isArray(payload.data.file_urls)) {
      throw this.parsePayloadError(payload, 'precision');
    }
    const batchId = payload.data.batch_id;
    const uploadUrls = payload.data.file_urls;
    onState?.({ phase: 'uploading', batchId, total: items.length });
    for (let i = 0; i < items.length; i++) {
      await uploadToSignedUrl(items[i].filePath, uploadUrls[i], { signal, timeoutMs: opts.timeoutMs, userAgent: this.userAgent });
      onState?.({ phase: 'uploaded', batchId, done: i + 1, total: items.length });
    }
    const results = await this.waitBatch({ batchId, api: 'precision', opts, signal, onState });
    return { api: 'precision', batchId, results };
  }

  /** Poll a precision batch until every item is done/failed. */
  async waitBatch({ batchId, api, opts, signal, onState }) {
    const deadline = Date.now() + (opts.timeoutMs ?? 600000);
    let last = [];
    for (;;) {
      if (Date.now() > deadline) {
        throw new MineruError(
          'MinerU 批量任务等待超时（' + (opts.timeoutMs ?? 600000) + 'ms）。可稍后用 mineru_task 查询 batchId=' + batchId + '。',
          'MINERU_TIMEOUT', { taskId: batchId, api },
        );
      }
      await this.poll.acquire(signal);
      const { payload } = await requestJsonWithRetry({
        url: this.baseUrl + '/api/v4/extract-results/batch/' + encodeURIComponent(batchId),
        headers: this.authHeaders(),
        signal, timeoutMs: 60000, userAgent: this.userAgent,
      });
      if (!payload || payload.code !== 0) throw this.parsePayloadError(payload, 'precision');
      last = Array.isArray(payload.data?.extract_result) ? payload.data.extract_result : [];
      const active = last.filter((r) => !['done', 'failed'].includes(r.state));
      if (last.length > 0 && active.length === 0) {
        onState?.({ phase: 'done', batchId, state: last });
        return last.map((r) => ({
          name: r.file_name,
          state: r.state,
          fullZipUrl: r.full_zip_url,
          errMsg: r.err_msg,
          progress: r.extract_progress,
          dataId: r.data_id,
        }));
      }
      onState?.({ phase: 'waiting', batchId, state: last });
      await sleep(opts.pollIntervalMs + Math.floor(Math.random() * (opts.pollJitterMs + 1)), signal);
    }
  }

  /** Download and extract one precision result zip. */
  async collectPrecisionZip({ zipUrl, destDir, opts, signal }) {
    await mkdir(destDir, { recursive: true });
    const zipPath = join(destDir, 'result.zip');
    await downloadTo(zipUrl, zipPath, {
      signal, timeoutMs: Math.max(opts.timeoutMs ?? 600000, 120000),
      userAgent: this.userAgent, maxBytes: 1 << 30,
    });
    this.trackTmp(zipPath);
    const { files } = await extractZip(zipPath, destDir, { signal, maxTotalBytes: 1 << 30 });
    const markdownEntry = files.find((f) => f.name === 'full.md') ?? files.find((f) => f.name.endsWith('/full.md'));
    let markdownText = '';
    let markdownBytes = 0;
    if (markdownEntry) {
      const md = await readZipEntryText(zipPath, markdownEntry.name, { signal, maxBytes: 64 << 20 });
      markdownText = md?.text ?? '';
      markdownBytes = md?.bytes ?? 0;
    }
    const contentList = files.find((f) => /_content_list\.json$/.test(f.name) || f.name === 'content_list.json');
    const layoutJson = files.find((f) => /layout\.json$/.test(f.name));
    return { zipPath, files, markdownEntry, markdownText, markdownBytes, contentListEntry: contentList, layoutEntry: layoutJson };
  }

  /** Download one agent-API markdown result. */
  async collectAgentMarkdown({ markdownUrl, destDir, opts, signal }) {
    await mkdir(destDir, { recursive: true });
    const destPath = join(destDir, 'full.md');
    const bytes = await downloadTo(markdownUrl, destPath, {
      signal, timeoutMs: Math.max(opts.timeoutMs ?? 600000, 120000),
      userAgent: this.userAgent, maxBytes: 64 << 20,
    });
    const text = await readFile(destPath, 'utf8');
    return { markdownPath: destPath, markdownText: text, markdownBytes: bytes };
  }

  /** Collect a finished single task's result into destDir (task or url based). */
  async collectSingle({ outcome, destDir, opts, signal }) {
    if (outcome.state !== 'done') {
      throw new MineruError('任务未完成（state=' + outcome.state + '），无法收集结果。', 'MINERU_NOT_DONE', { taskId: outcome.taskId, api: outcome.api });
    }
    if (outcome.api === 'precision') {
      if (!outcome.fullZipUrl) throw new MineruError('精准解析任务完成但缺少 full_zip_url。', 'MINERU_API', { taskId: outcome.taskId, api: outcome.api });
      return this.collectPrecisionZip({ zipUrl: outcome.fullZipUrl, destDir, opts, signal });
    }
    if (!outcome.markdownUrl) throw new MineruError('Agent 解析任务完成但缺少 markdown_url。', 'MINERU_API', { taskId: outcome.taskId, api: outcome.api });
    return this.collectAgentMarkdown({ markdownUrl: outcome.markdownUrl, destDir, opts, signal });
  }
}

/** Resolve per-call options from config + tool args. */
export function resolveOptions(cfg, args) {
  const modelVersion = args.modelVersion ?? cfg.modelVersion;
  if (!MODEL_VERSION_VALUES.includes(modelVersion)) {
    throw new MineruError('model_version 必须是 pipeline / vlm / MinerU-HTML 之一。', 'MINERU_BAD_ARGS');
  }
  return {
    language: args.language ?? cfg.language,
    enableTable: args.enableTable ?? cfg.enableTable,
    enableFormula: args.enableFormula ?? cfg.enableFormula,
    isOcr: args.isOcr ?? cfg.isOcr,
    modelVersion,
    pageRanges: args.pageRanges ?? undefined,
    pageRange: args.pageRange ?? undefined,
    extraFormats: args.extraFormats ?? cfg.extraFormats ?? [],
    dataId: sanitizeDataId(args.dataId),
    dataIdPrefix: sanitizeDataId(args.dataIdPrefix),
    timeoutMs: args.timeoutMs ?? cfg.timeoutMs,
    pollIntervalMs: cfg.pollIntervalMs,
    pollJitterMs: cfg.pollJitterMs,
  };
}

/** Force the MinerU-HTML model for HTML sources (precision). */
export function effectiveModelFor(ext, modelVersion) {
  if (ext === '.html' || ext === '.htm') {
    if (modelVersion !== 'MinerU-HTML') {
      return { modelVersion: 'MinerU-HTML', forced: true };
    }
  }
  return { modelVersion, forced: false };
}