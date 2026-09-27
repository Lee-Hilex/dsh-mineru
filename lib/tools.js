/**
 * Tool definitions: mineru_activate (bootstrap), mineru_parse, mineru_batch_parse,
 * mineru_task. The three parsing tools mount per agent after activation (or
 * globally under exposeMode: always).
 * @module dsh-mineru/tools
 */
import { basename, dirname, extname, join, resolve as pathResolve } from 'node:path';
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { AGENT_UNSUPPORTED_EXTENSIONS, EXTRA_FORMAT_VALUES, LANGUAGE_VALUES, SUPPORTED_EXTENSIONS } from './config.js';
import { MineruError, PRECISION_PAGE_LIMIT, effectiveModelFor, resolveOptions, sanitizeDataId } from './mineru-client.js';
import { mergeChunksMarkdown, remapChunkPages } from './chunk-merge.js';
import { planPageChunks, parsePageRanges } from './page-ranges.js';
import { countPdfPages } from './pdf-pages.js';
import { readContentListFile, synthesizeDocument } from './anchors.js';
import { buildPageLabels, checkLabelCoverage, formatLabelMismatchWarning, validateSegments } from './page-labels.js';
import { sanitizeFileName } from './artifacts.js';
import { SKILL_NAME } from './skill.js';

export const ACTIVATE_TOOL_NAME = 'mineru_activate';
export const TOOL_NAMES = Object.freeze(['mineru_parse', 'mineru_batch_parse', 'mineru_task']);

const MODE_ENUM = ['auto', 'precision', 'agent'];
const MODEL_ENUM = ['pipeline', 'vlm', 'MinerU-HTML'];

const isUrlSource = (s) => /^https?:\/\//i.test(String(s ?? ''));

function extOf(name) {
  return extname(name).toLowerCase();
}

/** @param {number} n @returns {string} */
function formatBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + units[i];
}

/** Bound a markdown preview on UTF-8 boundaries. */
function truncateMarkdown(text, maxBytes) {
  const buf = Buffer.from(text ?? '', 'utf8');
  if (buf.length <= maxBytes) return { markdown: text ?? '', truncated: false, bytes: buf.length };
  const cut = buf.subarray(0, maxBytes);
  let end = cut.length;
  while (end > 0 && (cut[end - 1] & 0xc0) === 0x80) end--;
  return {
    markdown: cut.subarray(0, end).toString('utf8') + '\n...(预览已截断, 完整内容见 Artifact full.md)',
    truncated: true,
    bytes: buf.length,
  };
}

/** Shared option parameters for the three parsing tools. */
function parseOptionParams() {
  return {
    mode: { type: 'string', enum: MODE_ENUM, description: 'API 模式: auto 按 Token 是否配置自动选择, precision 强制精准解析(需 Token), agent 强制 Agent 轻量解析.' },
    modelVersion: { type: 'string', enum: MODEL_ENUM, description: '精准解析模型版本: pipeline / vlm(默认, 推荐) / MinerU-HTML. HTML 源自动强制 MinerU-HTML.' },
    language: { type: 'string', enum: LANGUAGE_VALUES, description: '文档语言包, 默认 ch (中英). 常用: en, japan, korean, latin, arabic, cyrillic, east_slavic, devanagari.' },
    enableTable: { type: 'boolean', description: '是否开启表格识别, 默认 true.' },
    enableFormula: { type: 'boolean', description: '是否开启公式识别, 默认 true.' },
    isOcr: { type: 'boolean', description: '是否强制 OCR, 默认 false.' },
    pageRanges: { type: 'string', description: '精准解析页码范围, 逗号分隔: "2,4-6", 支持倒数页码 "2--2". 不传表示整份文档; 本次要解析的页数超过单次 200 页上限时(仅工作区 PDF, 本地能读出页数), 自动按页分片提交并合并结果.' },
    pageRange: { type: 'string', description: 'Agent 轻量解析页码范围, 仅支持 from-to 或单页: "1-10".' },
    extraFormats: { type: 'array', items: { type: 'string', enum: EXTRA_FORMAT_VALUES }, description: '精准解析额外导出格式: docx / html / latex.' },
    anchor: { type: 'boolean', description: '额外产出一份带页级块锚点的 document.md (每块前一行 <!-- pN bK -->, N 为原文页码, K 为页内块序, 默认 false). 仅精准解析 API 的结果含 content_list.json, 故该产物只在精准解析下生成; 开启后 full.md 等既有产物不变.' },
    segments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'number', required: true, description: '区间起始物理页 (1 基, 含).' },
          to: { type: 'number', required: true, description: '区间结束物理页 (1 基, 含).' },
          label: { type: 'string', description: '该区间起始页的印刷标签, 按它本身的体例递增: 罗马 "i" -> i, ii, iii…; 阿拉伯 "1" -> 1, 2, 3… (与 start 二选一).' },
          start: { type: 'number', description: '该区间起始页的阿拉伯页码, 逐页递增 (与 label 二选一).' },
        },
      },
      description: '声明物理页 -> 印刷页码的页码体系: [{from,to,label}] 或 [{from,to,start}], 1 基物理页区间, 需升序、不重叠、from<=to. 传了就写一份 page-map.json (逐页给出物理页 -> 印刷标签, 并附声明原文与未覆盖页); 同时开 anchor: true 时, document.md 里每页第一个块前多一行 > 印刷页码：<label> (锚点本体不变). 声明与云端 page_number 自检不一致时给出提示, 一致或一页都没识别到时保持安静.',
    },
    dataId: { type: 'string', description: '解析对象对应的业务数据 ID (可选, <=128 字符).' },
    timeoutMs: { type: 'number', description: '整个操作(含轮询等待)的超时毫秒数, 默认取插件配置.' },
  };
}

/**
 * @param {object} state plugin state (tools are built per plugin instance)
 * @returns {(args: object, exec: import('@deepseek-ai/dsh-tools').ToolRunContext) => Promise<object>}
 */
function makeActivateExecute(state) {
  return async function activateExecute(_args, exec) {
    const agent = exec.agent;
    if (!agent || !agent.ctx) {
      throw new Error('mineru_activate 需要在 agent 会话中调用 (exec.agent 不可用)');
    }
    const facts = await state.collectFacts();
    const already = state.activatedAgents.has(agent);
    if (!already) {
      for (const def of state.agentToolDefs) {
        agent.ctx.tools.register(def);
      }
      agent.ctx.tools.restrict({ deny: [ACTIVATE_TOOL_NAME] });
      state.activatedAgents.add(agent);
    }
    return {
      ok: true,
      active: true,
      already,
      tools: [...TOOL_NAMES],
      skill: SKILL_NAME,
      mode: facts.mode,
      api: facts.api,
      tokenConfigured: facts.tokenConfigured,
      modelVersion: facts.modelVersion,
      limits: {
        precision: '<=200MB / <=200 页 / 支持批量',
        agent: '<=10MB / <=20 页 / 仅单文件 Markdown',
      },
    };
  };
}

/** Build the activation bootstrap tool (registered globally in progressive mode). */
export function buildActivateTool(state) {
  return defineTool({
    name: ACTIVATE_TOOL_NAME,
    description: '激活 MinerU 多模态文档解析工具集 (mineru_parse / mineru_batch_parse / mineru_task). 本插件默认只暴露此引导工具以节省上下文; 调用一次即可解锁其余工具, 激活后此工具对本会话隐藏. 解析能力: PDF/Word/PPT/Excel/HTML/图片 -> 结构化 Markdown (精准解析 API 需 Token, Agent 轻量 API 免 Token).',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean' },
          active: { type: 'boolean' },
          already: { type: 'boolean' },
          tools: { type: 'array', items: { type: 'string' } },
          skill: { type: 'string' },
          mode: { type: 'string' },
          api: { type: 'string' },
          tokenConfigured: { type: 'boolean' },
          modelVersion: { type: 'string' },
          limits: { type: 'object', additionalProperties: false, properties: { precision: { type: 'string' }, agent: { type: 'string' } } },
        },
      },
      render(_args, value) {
        return [{
          type: 'text',
          text: [
            'MinerU 解析已激活.',
            '- 模式: ' + value.mode + ' -> ' + value.api + ' (' + (value.tokenConfigured ? 'Token 已配置' : '未配置 Token, 使用 Agent 轻量解析') + ')',
            '- 已解锁工具: ' + value.tools.join(', '),
            '- 限制: 精准解析 ' + value.limits.precision + '; Agent 轻量 ' + value.limits.agent,
            '使用 skill 工具加载 ' + value.skill + ' 可查看完整用法.',
          ].join('\n'),
        }];
      },
    },
    timeoutMs: 30000,
    execute: makeActivateExecute(state),
  });
}/**
 * Decide whether this call can be split into several `page_ranges` requests.
 *
 * Splitting needs the page count **locally**: of all supported formats only a
 * PDF can be counted without calling the API (see `countPdfPages`), and only the
 * precision API takes `page_ranges` at all. Everything else — the tokenless
 * Agent API, URL sources (the bytes are not on disk), non-PDF formats — keeps
 * the previous single-request behaviour, and the failure path then explains why
 * no split happened instead of quietly retrying.
 *
 * @param {{api: string, ext: string, filePath: string|null, urlSource: boolean, pageRanges: string|undefined}} input
 * @returns {Promise<{reason: string, chunks: object[], totalPages: number|null, method: string|null, pagesRequested: number|null}>}
 */
async function planChunking({ api, ext, filePath, urlSource, pageRanges }) {
  const none = (reason) => ({ reason, chunks: [], totalPages: null, method: null, pagesRequested: null });
  if (api !== 'precision') return none('agent-api');
  if (urlSource) return none('url-source');
  if (ext !== '.pdf') return none('pages-unknown');
  let bytes;
  try {
    bytes = await readFile(filePath);
  } catch {
    return none('unreadable');
  }
  const counted = countPdfPages(bytes);
  if (!Number.isInteger(counted.pages) || counted.pages < 1) return none('pages-undetermined');
  let spec;
  if (pageRanges === undefined) {
    spec = { pages: Array.from({ length: counted.pages }, (_, index) => index + 1) };
  } else {
    try {
      spec = parsePageRanges(pageRanges, { totalPages: counted.pages });
    } catch {
      // The server stays the authority on `page_ranges` syntax: a spec it
      // accepts but the local planner cannot split must not start failing here.
      // Pass it through untouched and report why no split happened.
      return { ...none('unparsable-ranges'), totalPages: counted.pages, method: counted.method };
    }
  }
  const chunks = planPageChunks(spec.pages, PRECISION_PAGE_LIMIT);
  return {
    reason: chunks.length > 1 ? 'over-limit' : 'within-limit',
    chunks,
    totalPages: counted.pages,
    method: counted.method,
    pagesRequested: spec.pages.length,
  };
}

/**
 * Why this call was not split automatically, phrased as a clause.
 * @param {{reason: string}} plan @returns {string|null}
 */
function chunkingUnavailableReason(plan) {
  switch (plan.reason) {
    case 'url-source': return 'URL 源的文件不在本地，读不出页数';
    case 'pages-unknown': return '该格式（docx/pptx 等）的页数只能由云端读出';
    case 'pages-undetermined': return '本地读不出这份 PDF 的页数（加密或结构异常）';
    case 'unreadable': return '本地读取文件失败';
    case 'unparsable-ranges': return 'pageRanges 写法在本地解析不出来（要求升序、不重叠、页码在文档总页数之内）';
    case 'agent-api': return 'Agent 轻量解析 API 按 IP 限流，不做自动分片';
    default: return null;
  }
}

/** True when an API failure is the per-request page cap. */
function isPageLimitFailure(err) {
  if (!(err instanceof MineruError)) return false;
  if (String(err.rawCode ?? '') === '-60006') return true;
  return /-60006|页数超(出|过)限制|page[^\n]{0,16}(limit|count)/i.test(String(err.message ?? ''));
}

/**
 * Name the chunk this failure belongs to, and keep its actionable code.
 *
 * The upstream failure semantics stay: one failed chunk fails the call and the
 * run directory is removed. Only the message gains the chunk's page range, so a
 * multi-chunk run is debuggable without a local state file.
 */
function withChunkLabel(label, err) {
  if (err?.name === 'AbortError') return err;
  const message = label + '：' + (err?.message ?? String(err));
  const wrapped = err instanceof MineruError
    ? new MineruError(message, err.code, { httpStatus: err.httpStatus, taskId: err.taskId, api: err.api, rawCode: err.rawCode })
    : new MineruError(message, err?.code ?? 'MINERU_ERROR');
  wrapped.cause = err;
  return wrapped;
}

/** Append the call-specific reason when the page cap was hit without a split. */
function withChunkingHint(err, plan) {
  if (plan.reason === 'within-limit') return err;
  if (!isPageLimitFailure(err)) return err;
  const reason = chunkingUnavailableReason(plan);
  if (!reason) return err;
  const wrapped = new MineruError(
    err.message + ' 未自动分片的原因：' + reason,
    err.code,
    { httpStatus: err.httpStatus, taskId: err.taskId, api: err.api, rawCode: err.rawCode },
  );
  wrapped.cause = err;
  return wrapped;
}

/** One `data_id` per chunk, so two chunks of one file cannot collide server-side. */
function chunkDataId(base, chunk) {
  const suffix = 'p' + chunk.spec.replace(/,/g, '_');
  return sanitizeDataId(base ? String(base) + '-' + suffix : suffix);
}

/** The on-disk path of one extracted zip entry, or null. */
function extractedPath(collected, entry) {
  if (!entry) return null;
  const file = (collected.files ?? []).find((candidate) => candidate.name === entry.name);
  return file?.path ?? null;
}

/**
 * Move one chunk's `images/` entries to the run root.
 *
 * Image names are content hashes, so the union of all chunks is conflict-free
 * and the merged `full.md` keeps resolving its relative image links. Same-named
 * entries from two chunks are the same bytes; `copyFile` overwrites on every
 * platform, while `rename` refuses an existing target on Windows.
 *
 * Entry names come from the zip extractor, which already rejects absolute and
 * `..` names, so every target stays inside the run directory.
 *
 * @returns {Promise<number>} how many entries were moved
 */
async function hoistChunkImages(collected, runDir) {
  let moved = 0;
  for (const file of collected.files ?? []) {
    if (!file.name.startsWith('images/')) continue;
    const target = join(runDir, file.name);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(file.path, target);
    await rm(file.path, { force: true });
    moved += 1;
  }
  return moved;
}

/**
 * Split path: one `page_ranges` request per chunk, then merge into one result.
 *
 * Each chunk is an independent batch over the same upload, collected into
 * `chunks/chunk-<n>/`, and the run root is rebuilt with the layout a single
 * request produces: `full.md` (concatenated, one provenance line per chunk) plus
 * `content_list.json` (merged, page indexes mapped back) plus the union of
 * `images/`. `layout.json` and `<uuid>_model.json` are page-indexed arrays, so
 * they stay per chunk where they remain readable.
 *
 * @returns {Promise<{chunks: object[], taskId: null, batchId: null, markdownText: string, markdownBytes: number}>}
 */
async function runChunkedParse({ client, filePath, fileName, opts, plan, dir, manager, exec, warnings }) {
  const records = [];
  for (const chunk of plan.chunks) {
    const label = '第 ' + chunk.index + '/' + plan.chunks.length + ' 片（第 ' + chunk.spec + ' 页）';
    const chunkStarted = Date.now();
    const chunkDir = join(dir, 'chunks', 'chunk-' + chunk.index);
    const chunkOpts = { ...opts, pageRanges: chunk.spec, dataId: chunkDataId(opts.dataId ?? fileName, chunk) };
    try {
      const outcome = await client.submitAndWaitFile({
        filePath, fileName, opts: chunkOpts, api: 'precision', signal: exec.signal,
      });
      if (outcome.state !== 'done') {
        throw new MineruError(
          '云端返回 state=' + outcome.state + (outcome.errMsg ? '：' + outcome.errMsg : ''),
          'MINERU_PARSE_FAILED',
          { taskId: outcome.taskId, api: 'precision', rawCode: outcome.errCode },
        );
      }
      if (!outcome.fullZipUrl) {
        throw new MineruError('云端状态为 done 但没有返回结果包地址', 'MINERU_API', { taskId: outcome.taskId, api: 'precision' });
      }
      const collected = await client.collectPrecisionZip({
        zipUrl: outcome.fullZipUrl, destDir: chunkDir, opts: chunkOpts, signal: exec.signal,
      });
      records.push({
        chunk,
        label,
        batchId: outcome.batchId ?? null,
        taskId: outcome.taskId ?? null,
        dataId: chunkOpts.dataId ?? null,
        collected,
        durationMs: Date.now() - chunkStarted,
      });
    } catch (err) {
      throw withChunkLabel(label, err);
    }
  }

  const blocks = [];
  const segments = [];
  let outOfRangeBlocks = 0;
  let imageCount = 0;
  for (const record of records) {
    const contentListPath = extractedPath(record.collected, record.collected.contentListEntry);
    let parsed = null;
    if (contentListPath) {
      try {
        parsed = JSON.parse(await readFile(contentListPath, 'utf8'));
      } catch {
        parsed = null;
      }
    }
    if (!Array.isArray(parsed)) {
      throw new MineruError(
        record.label + '：结果里的 content_list.json 缺失或不是合法 JSON 数组（分片页码映射依赖它）',
        'MINERU_API',
        { api: 'precision' },
      );
    }
    const mapped = remapChunkPages(parsed, record.chunk.pages);
    blocks.push(...mapped.blocks);
    outOfRangeBlocks += mapped.outOfRange;
    segments.push({
      note: 'chunk ' + record.chunk.index + '/' + plan.chunks.length
        + ': pages ' + record.chunk.spec
        + ' (batch_id ' + (record.batchId ?? '-') + ')',
      markdown: record.collected.markdownText ?? '',
    });
    imageCount += await hoistChunkImages(record.collected, dir);
  }

  const markdownText = mergeChunksMarkdown(segments);
  await manager.writeFile(dir, 'full.md', markdownText);
  await manager.writeFile(dir, 'content_list.json', JSON.stringify(blocks, null, 2));
  if (outOfRangeBlocks > 0) {
    warnings.push('有 ' + outOfRangeBlocks + ' 个块的 page_idx 落在请求页范围之外，已从合并的 content_list.json 里摘除该字段（页码不可信，宁缺勿错）');
  }
  warnings.push('多分片结果：layout.json 与 <uuid>_model.json 按页数组组织，按片保留在 chunks/chunk-<n>/ 下（共 ' + imageCount + ' 个图片条目已并入 images/）');

  return {
    chunks: records.map((record) => ({
      index: record.chunk.index,
      range: record.chunk.spec,
      pages: record.chunk.pages.length,
      batchId: record.batchId,
      taskId: record.taskId,
      dataId: record.dataId,
      state: 'done',
      durationMs: record.durationMs,
    })),
    taskId: null,
    batchId: null,
    markdownText,
    markdownBytes: Buffer.byteLength(markdownText, 'utf8'),
  };
}

/** Single-request path: one submit, one collect — the pre-existing behaviour. */
async function runSingleRequest({ client, urlSource, source, filePath, fileName, opts, api, dir, exec, plan }) {
  const started = Date.now();
  const outcome = urlSource
    ? await client.submitAndWaitUrl({ url: source, fileName, opts, api, signal: exec.signal })
    : await client.submitAndWaitFile({ filePath, fileName, opts, api, signal: exec.signal });
  const collected = await client.collectSingle({ outcome, destDir: dir, opts, signal: exec.signal });
  return {
    collected,
    taskId: outcome.taskId ?? null,
    batchId: outcome.batchId ?? null,
    markdownText: collected.markdownText ?? '',
    markdownBytes: collected.markdownBytes ?? null,
    chunks: [{
      index: 1,
      range: opts.pageRanges ?? null,
      pages: plan.chunks.length === 1 ? plan.chunks[0].pages.length : null,
      batchId: outcome.batchId ?? null,
      taskId: outcome.taskId ?? null,
      dataId: opts.dataId ?? null,
      state: 'done',
      durationMs: Date.now() - started,
    }],
  };
}
/**
 * Fail fast on a malformed `segments` declaration.
 *
 * Checked before anything is uploaded, so a typo costs the call and nothing else.
 * @param {unknown} segments
 */
function assertSegments(segments) {
  if (segments === undefined || segments === null) return;
  const checked = validateSegments(segments);
  if (!checked.ok) {
    throw new MineruError('segments 声明不合法：' + checked.error, 'MINERU_BAD_ARGS');
  }
}

/**
 * Write `page-map.json`: one printed label per declared page, the declaration it
 * came from, and what this run could not cover.
 *
 * @param {object} input
 * @param {{writeFile: Function}} input.manager artifact manager owning the run dir
 * @param {string} input.dir absolute run dir
 * @param {{segments: object[], pages: object[]}} input.declaration built declaration
 * @param {number[]|null} input.observedPages physical pages this run parsed
 * @param {boolean} [input.wholeDocument] the parsed pages are the entire file
 * @param {{mismatches: object[]}|null} [input.selfCheck] `pageNumbers` of the render
 * @param {string} [input.note] why coverage could not be judged
 * @returns {Promise<object>} summary carried by the tool result
 */
async function writePageMapFile({ manager, dir, declaration, observedPages, wholeDocument, selfCheck, note }) {
  const coverage = checkLabelCoverage(declaration, observedPages, { wholeDocument: wholeDocument === true });
  const warnings = [...coverage.warnings];
  if (note) warnings.unshift(note);
  // A declaration that disagrees with what the cloud read is a finding about the
  // declaration, so it is reported here rather than in the anchor summary — and
  // only once, whether or not `document.md` was written too.
  const mismatch = selfCheck ? formatLabelMismatchWarning(selfCheck.mismatches) : null;
  if (mismatch) warnings.push(mismatch);
  let firstPage = null;
  let lastPage = null;
  for (const page of Array.isArray(observedPages) ? observedPages : []) {
    if (!Number.isFinite(page)) continue;
    if (firstPage === null || page < firstPage) firstPage = page;
    if (lastPage === null || page > lastPage) lastPage = page;
  }
  const pageRange = firstPage === null ? null : { first: firstPage, last: lastPage };
  const document = {
    version: 1,
    segments: declaration.segments,
    pages: declaration.pages,
    pageRange,
    uncoveredPages: coverage.uncoveredPages,
    outOfRangePages: coverage.outOfRangePages,
    warnings,
  };
  await manager.writeFile(dir, 'page-map.json', JSON.stringify(document, null, 2));
  return {
    document: join(dir, 'page-map.json'),
    written: true,
    pages: declaration.pages.length,
    pageRange,
    uncoveredPages: coverage.uncoveredPages,
    warnings,
  };
}

/**
 * Write the optional per-run views derived from `content_list.json`: the
 * page-anchored `document.md` (`anchor: true`) and the declared printed-page
 * `page-map.json` (`segments`).
 *
 * The two are independent — a declaration alone still writes its map — and the
 * content list is read once for both. Both stay additive: `full.md`,
 * `content_list.json` and `layout.json` keep their existing shape, and a result
 * without a `content_list.json` (the Agent API) only produces warnings instead
 * of failing the parse.
 *
 * @param {object} input
 * @param {{writeFile: Function}} input.manager artifact manager owning the run dir
 * @param {string} input.dir absolute run dir
 * @param {object} [input.collected] value returned by `client.collectSingle`
 * @param {object} input.opts resolved API options (carries `pageRanges`)
 * @param {string} [input.contentListPath] explicit list path (the merged chunk list)
 * @param {boolean} [input.absolutePages] the list already uses absolute pages
 * @param {boolean} [input.anchor] write `document.md`
 * @param {unknown} [input.segments] declared printed-page systems
 * @returns {Promise<{anchor: object|null, pageMap: object|null}>}
 */
async function writeRunOutputs({ manager, dir, collected, opts, contentListPath, absolutePages, anchor, segments }) {
  const outputs = { anchor: null, pageMap: null };
  const declaration = segments ? buildPageLabels(segments) : null;
  const listPath = contentListPath ?? collected?.contentListEntry?.path;

  let contentList = null;
  let unavailable = null;
  if (!listPath) {
    unavailable = '本结果不含 content_list.json（Agent 轻量解析 API 或异常结果包）';
  } else {
    try {
      contentList = await readContentListFile(listPath);
    } catch (err) {
      unavailable = '读取 content_list.json 失败: ' + (err?.message ?? String(err));
    }
  }

  if (!contentList) {
    if (anchor) {
      outputs.anchor = { document: null, written: false, warnings: [unavailable + '，未生成 document.md'] };
    }
    if (declaration) {
      outputs.pageMap = await writePageMapFile({
        manager,
        dir,
        declaration,
        observedPages: null,
        note: unavailable + '，page-map.json 只按声明的 segments 展开，哪些页没有印刷页码无法判定',
      });
    }
    return outputs;
  }

  const synthesis = synthesizeDocument(contentList, {
    pageRanges: absolutePages ? null : (typeof opts?.pageRanges === 'string' ? opts.pageRanges : null),
    pageLabels: declaration ? declaration.pages : null,
  });

  if (anchor) {
    await manager.writeFile(dir, 'document.md', synthesis.markdown);
    outputs.anchor = {
      document: join(dir, 'document.md'),
      written: true,
      blocks: synthesis.stats.bodyBlocks,
      pages: synthesis.stats.pages,
      pageNumbers: synthesis.pageNumbers,
      unreadableBlocks: synthesis.stats.unreadableBlocks,
      warnings: synthesis.warnings,
    };
  }
  if (declaration) {
    outputs.pageMap = await writePageMapFile({
      manager,
      dir,
      declaration,
      observedPages: synthesis.stats.pageNumbers,
      // A `pageRanges` request parses a subset on purpose, so a declared page
      // outside it means nothing; only a whole-file parse can call a declared
      // page missing from the document.
      wholeDocument: !(typeof opts?.pageRanges === 'string' && opts.pageRanges.trim() !== ''),
      selfCheck: synthesis.pageNumbers,
    });
  }
  return outputs;
}

/** Anchor summary: null when the caller did not ask for `document.md`. */
const ANCHOR_SCHEMA = { type: 'json' };

/** Page-label map summary: null when the caller did not pass `segments`. */
const PAGE_MAP_SCHEMA = { type: 'json' };

/**
 * Orchestrate one single-document parse: resolve mode/api, validate source,
 * submit (URL or signature upload), wait, download, extract into a fresh run
 * dir, and build the canonical result value.
 *
 * A precision request that asks for more than the per-request page cap is split
 * into `page_ranges` chunks transparently — no new parameter, same artifact
 * layout — while the Agent API and sources whose page count cannot be read
 * locally keep the single-request behaviour.
 * @param {object} input { source, args, cfg, exec, state }
 */
async function runSingleParse({ source, args, cfg, exec, state }) {
  const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
  const client = await state.clientFor(cfg);
  const { api, effectiveMode } = client.resolveApi(args.mode, cfg.mode);
  const opts = resolveOptions(cfg, args);
  assertSegments(opts.segments);

  let filePath = null;
  let fileName;
  let displayName;
  let fileSize = null;
  let ext = '';
  const urlSource = isUrlSource(source);
  if (urlSource) {
    let parsed;
    try { parsed = new URL(source); } catch {
      throw new MineruError('无效的 URL: ' + source, 'MINERU_BAD_ARGS');
    }
    displayName = basename(parsed.pathname) || 'document';
    ext = extOf(displayName);
    // An extension the server may not recognize is omitted from file_name so
    // MinerU parses it from the URL itself; displayName stays a real string.
    fileName = SUPPORTED_EXTENSIONS.includes(ext) ? displayName : undefined;
  } else {
    filePath = pathResolve(cwd, source);
    const checked = await client.checkLocalFile(filePath, api, cfg.maxFileBytes);
    fileName = basename(filePath);
    displayName = fileName;
    fileSize = checked.size;
    ext = checked.ext;
  }

  const warnings = [];
  if (api === 'precision') {
    const forced = effectiveModelFor(ext, opts.modelVersion);
    opts.modelVersion = forced.modelVersion;
    if (forced.forced) warnings.push('HTML 源已自动使用 MinerU-HTML 模型 (忽略其他 modelVersion)');
  } else if (ext && AGENT_UNSUPPORTED_EXTENSIONS.includes(ext)) {
    throw new MineruError(
      'Agent 轻量解析 API 不支持 ' + ext + ' 文件: 请改用精准解析 API (mode=precision 并配置 Token).',
      'MINERU_UNSUPPORTED_TYPE',
    );
  }

  const plan = await planChunking({ api, ext, filePath, urlSource, pageRanges: opts.pageRanges });
  const chunked = plan.chunks.length > 1;

  const manager = await state.artifacts.managerFor(cwd);
  const runBase = sanitizeFileName(args.output ?? (fileName ?? 'parse'));
  const { dir, relDir } = await manager.createRun(runBase);
  const started = Date.now();
  try {
    const result = chunked
      ? await runChunkedParse({ client, filePath, fileName, opts, plan, dir, manager, exec, warnings })
      : await runSingleRequest({ client, urlSource, source, filePath, fileName, opts, api, dir, exec, plan });
    const wantAnchor = args.anchor === true;
    const outputs = wantAnchor || opts.segments
      ? await writeRunOutputs({
        manager,
        dir,
        opts,
        collected: chunked ? undefined : result.collected,
        contentListPath: chunked ? join(dir, 'content_list.json') : undefined,
        absolutePages: chunked,
        anchor: wantAnchor,
        segments: opts.segments,
      })
      : { anchor: null, pageMap: null };
    const durationMs = Date.now() - started;
    if (chunked) {
      warnings.unshift('文档共 ' + plan.totalPages + ' 页，超过单次请求 ' + PRECISION_PAGE_LIMIT
        + ' 页上限，已自动分 ' + plan.chunks.length + ' 片解析并合并结果（每片一次 page_ranges 请求，timeoutMs 对每片生效）');
    }
    const warning = warnings.length > 0 ? warnings.join('；') : null;
    const metadata = {
      plugin: 'dsh-mineru',
      createdAt: new Date().toISOString(),
      source: urlSource ? source : filePath,
      sourceName: displayName,
      api, mode: effectiveMode, modelVersion: opts.modelVersion,
      taskId: result.taskId,
      batchId: result.batchId,
      state: 'done',
      durationMs,
      markdownBytes: result.markdownBytes,
      warning,
      // Only a split run adds chunk bookkeeping; a single-request run.json is
      // unchanged so anything reading it keeps working.
      ...(chunked ? {
        chunkCount: plan.chunks.length,
        pagesPerRequest: PRECISION_PAGE_LIMIT,
        pagesRequested: plan.pagesRequested,
        totalPages: plan.totalPages,
        pageCountMethod: plan.method,
        chunks: result.chunks,
      } : {}),
    };
    await manager.writeFile(dir, 'run.json', JSON.stringify(metadata, null, 2));
    const preview = truncateMarkdown(result.markdownText, cfg.inlineMarkdownBytes);
    const artifacts = await manager.describeRun(relDir, state.urlBuilder ? { capabilityFor: (rel) => state.urlBuilder(cwd, rel) } : undefined);
    return {
      ok: true,
      api, mode: effectiveMode, modelVersion: opts.modelVersion,
      taskId: result.taskId,
      batchId: result.batchId,
      state: 'done',
      durationMs,
      sourceName: displayName,
      sourceKind: urlSource ? 'url' : 'file',
      sourceBytes: fileSize,
      runDir: dir,
      warning,
      markdownBytes: result.markdownBytes,
      anchor: outputs.anchor,
      pageMap: outputs.pageMap,
      preview,
      artifacts,
      chunkCount: result.chunks.length,
      chunks: result.chunks,
    };
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw withChunkingHint(err, plan);
  }
}

const ARTIFACT_ITEM_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  name: { type: 'string' }, path: { type: 'string' }, rel: { type: 'string' },
  kind: { type: 'string' }, mime: { type: 'string' }, bytes: { type: 'number' }, url: { type: 'string' },
} };

/** One submitted request: the whole call, or one chunk of a split call. */
const CHUNK_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    index: { type: 'number' },
    range: { type: 'json' },
    pages: { type: 'json' },
    batchId: { type: 'json' },
    taskId: { type: 'json' },
    dataId: { type: 'json' },
    state: { type: 'string' },
    durationMs: { type: 'number' },
  },
};

const PARSE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    api: { type: 'string' },
    mode: { type: 'string' },
    modelVersion: { type: 'string' },
    taskId: { type: 'json' },
    batchId: { type: 'json' },
    state: { type: 'string' },
    durationMs: { type: 'number' },
    sourceName: { type: 'string' },
    sourceKind: { type: 'string' },
    sourceBytes: { type: 'json' },
    runDir: { type: 'string' },
    warning: { type: 'json' },
    markdownBytes: { type: 'json' },
    anchor: ANCHOR_SCHEMA,
    pageMap: PAGE_MAP_SCHEMA,
    preview: { type: 'object', additionalProperties: false, properties: { markdown: { type: 'string' }, truncated: { type: 'boolean' }, bytes: { type: 'number' } } },
    artifacts: { type: 'array', items: ARTIFACT_ITEM_SCHEMA },
    chunkCount: { type: 'number' },
    chunks: { type: 'array', items: CHUNK_ITEM_SCHEMA },
  },
};

function renderParseContent(value) {
  const lines = [
    'MinerU 解析完成 (' + value.api + ' API, ' + value.modelVersion + ', 耗时 ' + (value.durationMs / 1000).toFixed(1) + 's)',
    '- 任务: ' + (value.taskId ?? '-'),
    '- 结果目录: ' + value.runDir,
  ];
  const chunks = Array.isArray(value.chunks) ? value.chunks : [];
  if (chunks.length > 1) {
    lines.push('- 分片: ' + chunks.length + ' 片 (每片一次 page_ranges 请求, 结果已合并)');
    for (const chunk of chunks) {
      lines.push('  - 第 ' + chunk.index + '/' + chunks.length + ' 片: 第 ' + chunk.range + ' 页, batchId '
        + (chunk.batchId ?? '-') + ', ' + chunk.state + ', ' + ((chunk.durationMs ?? 0) / 1000).toFixed(1) + 's');
    }
  }
  if (value.warning) lines.push('- 注意: ' + value.warning);
  if (value.anchor?.written) {
    lines.push('- 页级块锚点: ' + value.anchor.document + ' (' + value.anchor.blocks + ' 个正文块 / ' + value.anchor.pages + ' 页)');
  }
  for (const note of value.anchor?.warnings ?? []) {
    lines.push('- 锚点提示: ' + note);
  }
  if (value.pageMap?.written) {
    lines.push('- 页码体系: ' + value.pageMap.document + ' (' + value.pageMap.pages + ' 页印刷标签'
      + (value.pageMap.uncoveredPages?.length > 0
        ? ', ' + value.pageMap.uncoveredPages.length + ' 页无映射'
        : '')
      + ')');
  }
  for (const note of value.pageMap?.warnings ?? []) {
    lines.push('- 页码体系提示: ' + note);
  }
  for (const a of value.artifacts ?? []) {
    lines.push('- Artifact: ' + a.name + ' (' + a.kind + ', ' + formatBytes(a.bytes) + ')' + (a.url ? ' 预览: ' + a.url : ''));
  }
  lines.push('完整 Markdown 位于 Artifact full.md, 请用 read 工具读取; 下方为预览:');
  lines.push('');
  lines.push(value.preview?.markdown ?? '');
  return [{ type: 'text', text: lines.join('\n') }];
}

/** Build the mineru_parse tool definition. */
export function buildParseTool(state) {
  return defineTool({
    name: 'mineru_parse',
    description: '用 MinerU 解析单个文档为结构化 Markdown: 支持 PDF/Word(doc,docx)/PPT(ppt,pptx)/Excel(xls,xlsx)/HTML/图片(png,jpg,jpeg,jp2,webp,gif,bmp). source 为工作区文件路径或 http(s) URL. 已配置 Token 时默认走精准解析 API(<=200MB/<=200页, Zip 含 full.md+JSON+可加 docx/html/latex), 未配置 Token 时走 Agent 轻量解析 API(<=10MB/<=20页, 仅 Markdown). 工作区 PDF 本次要解析的页数超过单次 200 页上限时, 自动按 page_ranges 分片提交并合并为一份结果(无需新参数; 多片时每片独立轮询, timeoutMs 对每片生效; layout.json 与模型 JSON 按片保留在 chunks/ 下). Agent 轻量解析 API 与本地读不出页数的来源不做自动分片. 结果落地到 <workspace>/.dsh-mineru/artifacts/<run>/ 并以 Artifact 列表返回.',
    parameters: {
      source: { type: 'string', required: true, description: '工作区文件路径或完整 http(s) URL.' },
      ...parseOptionParams(),
      output: { type: 'string', description: '结果目录基名 (默认取源文件名).' },
    },
    output: {
      schema: PARSE_RESULT_SCHEMA,
      render: (_args, value) => renderParseContent(value),
      presentationMeta: (_args, value) => value,
    },
    presentCall(args) {
      const source = String(args.source ?? '');
      const name = basename(source) || source;
      return {
        card: 'generic',
        title: 'MinerU 解析 ' + name,
        kind: 'fetch',
        rawInput: {
          source,
          mode: args.mode ?? 'auto',
          ...(args.modelVersion !== undefined ? { modelVersion: args.modelVersion } : {}),
          ...(args.language !== undefined ? { language: args.language } : {}),
        },
        locations: isUrlSource(source) ? undefined : [{ path: source }],
      };
    },
    presentResult(args, result) {
      const meta = result.meta;
      if (result.isError) return { card: 'generic', title: 'MinerU 解析失败: ' + (basename(String(args.source ?? '')) || args.source) };
      if (!meta || typeof meta !== 'object' || !meta.ok) return undefined;
      return {
        card: 'generic',
        title: 'MinerU 解析完成: ' + meta.sourceName,
        content: renderParseContent(meta),
      };
    },
    isConcurrencySafe: () => true,
    timeoutMs: 600000,
    async execute(args, exec) {
      const cfg = state.getCfg();
      return runSingleParse({ source: String(args.source ?? '').trim(), args, cfg, exec, state });
    },
  });
}/**
 * Orchestrate a precision-API batch parse. sources may mix local paths and
 * URLs; each group submits as its own batch (local <=50, urls <=200).
 */
async function runBatchParse({ sources, args, cfg, exec, state }) {
  const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
  const client = await state.clientFor(cfg);
  const { api } = client.resolveApi(args.mode ?? 'precision', cfg.mode);
  if (api !== 'precision') {
    throw new MineruError('mineru_batch_parse 仅精准解析 API 支持: 请配置 MinerU Token 后重试.', 'MINERU_TOKEN_REQUIRED');
  }
  const opts = resolveOptions(cfg, args);
  assertSegments(opts.segments);
  const manager = await state.artifacts.managerFor(cwd);
  const runBase = sanitizeFileName(args.outputPrefix ?? 'batch');
  const { dir, relDir } = await manager.createRun(runBase);
  const started = Date.now();
  const batchIds = [];
  const results = [];
  const flatArtifacts = [];
  let doneCount = 0;
  let failedCount = 0;
  const files = [];
  const urls = [];
  for (const raw of sources) {
    const s = String(raw ?? '').trim();
    if (!s) continue;
    if (isUrlSource(s)) urls.push({ url: s });
    else files.push({ filePath: pathResolve(cwd, s) });
  }
  if (files.length === 0 && urls.length === 0) {
    throw new MineruError('sources 为空: 至少提供一个文件路径或 URL.', 'MINERU_BAD_ARGS');
  }
  const MAX_URLS_PER_BATCH = 200;
  const MAX_FILES_PER_BATCH = 50;
  const MAX_TOTAL = 1000;
  if (urls.length + files.length > MAX_TOTAL) {
    throw new MineruError('sources 超过单次调用上限 ' + MAX_TOTAL + ' 个: 请拆分后多次调用 mineru_batch_parse.', 'MINERU_BATCH_TOO_LARGE');
  }
  try {
    const collectOne = async (item) => {
      if (item.state === 'done' && item.fullZipUrl) {
        const safeName = sanitizeFileName(item.name ?? ('item-' + results.length));
        const itemDir = joinSafe(dir, safeName);
        const collected = await client.collectPrecisionZip({ zipUrl: item.fullZipUrl, destDir: itemDir, opts, signal: exec.signal });
        const outputs = args.anchor === true || opts.segments
          ? await writeRunOutputs({ manager, dir: itemDir, collected, opts, anchor: args.anchor === true, segments: opts.segments })
          : { anchor: null, pageMap: null };
        doneCount += 1;
        const relItemDir = relDir.replace(/\\/g, '/') + '/' + safeName;
        const itemArtifacts = await manager.describeRun(relItemDir, state.urlBuilder ? { capabilityFor: (rel) => state.urlBuilder(cwd, rel) } : undefined);
        flatArtifacts.push(...itemArtifacts);
        results.push({ name: item.name, state: 'done', dir: itemDir, markdownBytes: collected.markdownBytes ?? null, anchor: outputs.anchor, pageMap: outputs.pageMap, artifacts: itemArtifacts });
      } else {
        failedCount += 1;
        results.push({ name: item.name, state: item.state ?? 'failed', errMsg: item.errMsg ?? null });
      }
    };
    // URLs auto-chunked into batches of <= 200.
    for (let i = 0; i < urls.length; i += MAX_URLS_PER_BATCH) {
      const r = await client.submitAndWaitBatchUrls({ items: urls.slice(i, i + MAX_URLS_PER_BATCH), opts, signal: exec.signal });
      batchIds.push(r.batchId);
      for (const item of r.results) await collectOne(item);
    }
    // Local files auto-chunked into batches of <= 50 upload links.
    for (let i = 0; i < files.length; i += MAX_FILES_PER_BATCH) {
      const items = [];
      for (const f of files.slice(i, i + MAX_FILES_PER_BATCH)) {
        const checked = await client.checkLocalFile(f.filePath, 'precision', cfg.maxFileBytes);
        items.push({ filePath: f.filePath, fileName: basename(f.filePath), dataId: undefined, size: checked.size });
      }
      const r = await client.submitAndWaitBatchFiles({ items, opts, signal: exec.signal });
      batchIds.push(r.batchId);
      for (const item of r.results) await collectOne(item);
    }
    const metadata = {
      plugin: 'dsh-mineru',
      createdAt: new Date().toISOString(),
      api: 'precision',
      modelVersion: opts.modelVersion,
      batchIds,
      total: results.length,
      done: doneCount,
      failed: failedCount,
      durationMs: Date.now() - started,
    };
    await manager.writeFile(dir, 'run.json', JSON.stringify(metadata, null, 2));
    const artifacts = await manager.describeRun(relDir, state.urlBuilder ? { capabilityFor: (rel) => state.urlBuilder(cwd, rel) } : undefined);
    return {
      ok: true,
      api: 'precision',
      modelVersion: opts.modelVersion,
      batchIds,
      state: 'done',
      durationMs: Date.now() - started,
      total: results.length,
      done: doneCount,
      failed: failedCount,
      runDir: dir,
      results,
      artifacts,
    };
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/** join with a sanitized single segment. */
function joinSafe(dir, name) {
  return join(dir, sanitizeFileName(name));
}

const BATCH_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    api: { type: 'string' },
    modelVersion: { type: 'string' },
    batchIds: { type: 'array', items: { type: 'string' } },
    state: { type: 'string' },
    durationMs: { type: 'number' },
    total: { type: 'number' },
    done: { type: 'number' },
    failed: { type: 'number' },
    runDir: { type: 'string' },
    results: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
      name: { type: 'string' }, state: { type: 'string' }, dir: { type: 'json' },
      errMsg: { type: 'json' }, markdownBytes: { type: 'json' },
      anchor: ANCHOR_SCHEMA,
      pageMap: PAGE_MAP_SCHEMA,
      artifacts: { type: 'array', items: ARTIFACT_ITEM_SCHEMA },
    } } },
    artifacts: { type: 'array', items: ARTIFACT_ITEM_SCHEMA },
  },
};

function renderBatchContent(value) {
  const lines = [
    'MinerU 批量解析完成 (精准解析 API, ' + value.modelVersion + ', 耗时 ' + (value.durationMs / 1000).toFixed(1) + 's)',
    '- 成功 ' + value.done + ' / 共 ' + value.total + (value.failed > 0 ? ', 失败 ' + value.failed : ''),
    '- 结果目录: ' + value.runDir,
  ];
  for (const r of value.results ?? []) {
    if (r.state === 'done') {
      lines.push('- [done] ' + r.name + ' -> ' + (r.dir ?? '') + '/full.md');
    } else {
      lines.push('- [' + (r.state ?? 'failed') + '] ' + r.name + ': ' + (r.errMsg ?? ''));
    }
  }
  lines.push('请用 read 工具读取各 full.md 全文.');
  return [{ type: 'text', text: lines.join('\n') }];
}

/** Build the mineru_batch_parse tool definition. */
export function buildBatchTool(state) {
  return defineTool({
    name: 'mineru_batch_parse',
    description: '用 MinerU 精准解析 API 批量解析文档 (需要 Token): sources 为工作区文件路径与 http(s) URL 的混合列表. 自动分批提交 (本地文件每批 <=50 个, URL 每批 <=200 个, 单次调用总共 <=1000 个). 每个文档的结果解包到独立子目录 (<run>/<文件名>/full.md). 解析成功与失败逐项列出.',
    parameters: {
      sources: { type: 'array', items: { type: 'string' }, required: true, description: '文件路径或 http(s) URL 列表 (本地<=50, URL<=200).' },
      ...parseOptionParams(),
      outputPrefix: { type: 'string', description: '结果目录基名 (默认 batch).' },
      dataIdPrefix: { type: 'string', description: '业务数据 ID 前缀, 每项自动追加序号 (可选).' },
    },
    output: {
      schema: BATCH_RESULT_SCHEMA,
      render: (_args, value) => renderBatchContent(value),
      presentationMeta: (_args, value) => value,
    },
    presentCall(args) {
      const sources = Array.isArray(args.sources) ? args.sources.map(String) : [];
      return {
        card: 'generic',
        title: 'MinerU 批量解析 (' + sources.length + ' 个文档)',
        kind: 'fetch',
        rawInput: {
          count: sources.length,
          ...(args.modelVersion !== undefined ? { modelVersion: args.modelVersion } : {}),
          ...(args.language !== undefined ? { language: args.language } : {}),
        },
      };
    },
    presentResult(args, result) {
      if (result.isError) return { card: 'generic', title: 'MinerU 批量解析失败' };
      const meta = result.meta;
      if (!meta || typeof meta !== 'object' || !meta.ok) return undefined;
      return { card: 'generic', title: 'MinerU 批量解析完成 (' + meta.done + '/' + meta.total + ')', content: renderBatchContent(meta) };
    },
    isConcurrencySafe: () => true,
    timeoutMs: 600000,
    async execute(args, exec) {
      const cfg = state.getCfg();
      return runBatchParse({ sources: Array.isArray(args.sources) ? args.sources : [], args, cfg, exec, state });
    },
  });
}const TASK_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean' },
    api: { type: 'string' },
    taskId: { type: 'string' },
    state: { type: 'string' },
    durationMs: { type: 'number' },
    waitUsed: { type: 'boolean' },
    collectible: { type: 'boolean' },
    zipUrl: { type: 'json' },
    markdownUrl: { type: 'json' },
    errMsg: { type: 'json' },
    progress: { type: 'json' },
    runDir: { type: 'json' },
    preview: { type: 'json' },
    anchor: ANCHOR_SCHEMA,
    pageMap: PAGE_MAP_SCHEMA,
    artifacts: { type: 'array', items: ARTIFACT_ITEM_SCHEMA },
  },
};

function renderTaskContent(value) {
  const lines = [
    'MinerU 任务 ' + value.taskId + ' (' + value.api + ' API): ' + value.state,
  ];
  if (value.progress?.total_pages) {
    lines.push('- 进度: ' + (value.progress.extracted_pages ?? 0) + '/' + value.progress.total_pages + ' 页');
  }
  if (value.zipUrl) lines.push('- 结果包: ' + value.zipUrl);
  if (value.markdownUrl) lines.push('- Markdown: ' + value.markdownUrl);
  if (value.runDir) lines.push('- 已收集到: ' + value.runDir);
  if (value.preview?.markdown) { lines.push(''); lines.push(value.preview.markdown); }
  return [{ type: 'text', text: lines.join('\n') }];
}

/** Build the mineru_task tool definition. */
export function buildTaskTool(state) {
  return defineTool({
    name: 'mineru_task',
    description: '查询 (并可选收集) 一个已提交的 MinerU 任务: 传入 submit 时返回的 taskId 与 api (precision=精准解析 / agent=Agent轻量解析). wait=true 时轮询直到 done/failed/超时, 默认只查询一次; collect=true 且任务已完成时, 下载结果并落地为 Artifact (用于超时后恢复收集).',
    parameters: {
      taskId: { type: 'string', required: true, description: '提交任务时返回的 task_id.' },
      api: { type: 'string', enum: ['precision', 'agent'], required: true, description: '任务所属 API: precision 或 agent.' },
      wait: { type: 'boolean', description: '是否轮询等待任务完成 (默认 false, 只查询一次).' },
      collect: { type: 'boolean', description: '任务完成时是否下载结果落地为 Artifact (默认 true).' },
      anchor: { type: 'boolean', description: '收集结果时额外产出一份带页级块锚点的 document.md (默认 false, 仅精准解析结果含 content_list.json).' },
      segments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'number', required: true, description: '区间起始物理页 (1 基, 含).' },
            to: { type: 'number', required: true, description: '区间结束物理页 (1 基, 含).' },
            label: { type: 'string', description: '该区间起始页的印刷标签, 按它本身的体例递增 (与 start 二选一).' },
            start: { type: 'number', description: '该区间起始页的阿拉伯页码, 逐页递增 (与 label 二选一).' },
          },
        },
        description: '收集结果时按声明的页码体系写一份 page-map.json (默认不写); 语义与 mineru_parse 的 segments 相同.',
      },
      output: { type: 'string', description: '收集结果目录基名 (默认 task).' },
      timeoutMs: { type: 'number', description: 'wait 模式下的超时毫秒数.' },
    },
    output: {
      schema: TASK_RESULT_SCHEMA,
      render: (_args, value) => renderTaskContent(value),
      presentationMeta: (_args, value) => value,
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: 'MinerU 任务查询 ' + String(args.taskId ?? '').slice(0, 24),
        kind: 'fetch',
        rawInput: { taskId: args.taskId, api: args.api, wait: Boolean(args.wait), collect: Boolean(args.collect) },
      };
    },
    presentResult(args, result) {
      if (result.isError) return { card: 'generic', title: 'MinerU 任务查询失败' };
      const meta = result.meta;
      if (!meta || typeof meta !== 'object') return undefined;
      return { card: 'generic', title: 'MinerU 任务 ' + meta.state + ': ' + String(args.taskId ?? '').slice(0, 24), content: renderTaskContent(meta) };
    },
    isConcurrencySafe: () => true,
    timeoutMs: 600000,
    async execute(args, exec) {
      const cfg = state.getCfg();
      const client = await state.clientFor(cfg);
      const api = String(args.api ?? 'precision');
      if (api !== 'precision' && api !== 'agent') throw new MineruError('api 必须是 precision 或 agent.', 'MINERU_BAD_ARGS');
      if (api === 'precision' && !client.precisionEnabled()) {
        throw new MineruError('查询精准解析任务需要 MinerU Token.', 'MINERU_TOKEN_REQUIRED');
      }
      const started = Date.now();
      const collect = args.collect !== false;
      const wait = args.wait === true;
      assertSegments(args.segments);
      let outcome;
      if (wait) {
        const opts = resolveOptions(cfg, { ...args, timeoutMs: args.timeoutMs });
        outcome = await client.waitTask({ taskId: String(args.taskId), api, opts, signal: exec.signal });
      } else {
        const status = await client.queryTask({ taskId: String(args.taskId), api, signal: exec.signal });
        outcome = {
          api, taskId: status.taskId, state: status.state,
          fullZipUrl: status.fullZipUrl, markdownUrl: status.markdownUrl,
          errMsg: status.errMsg, progress: status.progress,
        };
      }
      const base = {
        ok: true,
        api,
        taskId: String(args.taskId),
        state: outcome.state,
        durationMs: Date.now() - started,
        waitUsed: wait,
        collectible: outcome.state === 'done',
        zipUrl: outcome.fullZipUrl ?? null,
        markdownUrl: outcome.markdownUrl ?? null,
        errMsg: outcome.errMsg ?? null,
        progress: outcome.progress ?? null,
        runDir: null,
        preview: null,
        anchor: null,
        pageMap: null,
        artifacts: [],
      };
      if (outcome.state !== 'done') return base;
      if (!collect) return base;
      const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
      const manager = await state.artifacts.managerFor(cwd);
      const { dir, relDir } = await manager.createRun(sanitizeFileName(args.output ?? 'task'));
      const collectOpts = resolveOptions(cfg, { ...args, timeoutMs: args.timeoutMs });
      try {
        const collected = await client.collectSingle({ outcome, destDir: dir, opts: collectOpts, signal: exec.signal });
        const outputs = args.anchor === true || collectOpts.segments
          ? await writeRunOutputs({ manager, dir, collected, opts: collectOpts, anchor: args.anchor === true, segments: collectOpts.segments })
          : { anchor: null, pageMap: null };
        const metadata = {
          plugin: 'dsh-mineru',
          createdAt: new Date().toISOString(),
          api, taskId: String(args.taskId), state: 'done',
          collectedFrom: 'mineru_task',
          markdownBytes: collected.markdownBytes ?? null,
        };
        await manager.writeFile(dir, 'run.json', JSON.stringify(metadata, null, 2));
        const preview = truncateMarkdown(collected.markdownText, cfg.inlineMarkdownBytes);
        const artifacts = await manager.describeRun(relDir, state.urlBuilder ? { capabilityFor: (rel) => state.urlBuilder(cwd, rel) } : undefined);
        return {
          ...base,
          state: 'done',
          runDir: dir,
          preview,
          anchor: outputs.anchor,
          pageMap: outputs.pageMap,
          artifacts,
        };
      } catch (err) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
        throw err;
      }
    },
  });
}

/** Build all three parsing tools (used by progressive activation and exposeMode: always). */
export function buildAgentTools(state) {
  return [buildParseTool(state), buildBatchTool(state), buildTaskTool(state)];
}