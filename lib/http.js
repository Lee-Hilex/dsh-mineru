/**
 * Web host surface for the Web profile: /plugin/mineru/* routes serving the
 * Settings card, credential writes, token/agent connection tests, and signed
 * artifact preview/download.
 *
 * Config reads/writes go through the settings seam (revision-fenced); the
 * token VALUE crosses the wire only inside a POST body and is stored through
 * the credentials seam. Origin checks allow only same-origin browser calls.
 * @module dsh-mineru/http
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { SettingsConflictError } from '@deepseek-ai/dsh-settings';
import { MineruError } from './mineru-client.js';
import { ArtifactError, inlineable, sanitizeFileName } from './artifacts.js';
import { DEFAULTS, SUPPORTED_EXTENSIONS } from './config.js';

const JSON_BODY_LIMIT = 1 << 20;

function readBody(req, limit = JSON_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(text);
}

function sendEmpty(res, status) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff' });
  res.end();
}

/** @param {string} value */
function stripToken(value) {
  const v = String(value ?? '').trim();
  return v.length > 0 && v.length <= 4096 ? v : undefined;
}

/**
 * Mount the /plugin/mineru route tree.
 * @param {object} ctx injected web context (webServer service available)
 * @param {object} deps
 * @param {object} deps.settings the settings service (describe)
 * @param {object} deps.scope the mineru SettingsScope (get/update)
 * @param {object} deps.credentials the credentials service
 * @param {object} deps.schema the registered schemastery schema
 * @param {object} deps.state plugin state (clientFor, collectFacts, artifacts)
 */
export function mountHttp(ctx, deps) {
  const { webServer } = ctx;
  ctx.effect(() => webServer.register({
    kind: 'prefix',
    path: '/plugin/mineru',
    handler: (req, res) => handle(req, res, { ...deps, webServer }).catch((err) => {
      if (!res.headersSent) {
        if (err instanceof ArtifactError) {
          const status = err.code === 'ARTIFACT_NOT_FOUND' ? 404 : 400;
          sendJson(res, status, { ok: false, error: err.message });
          return;
        }
        sendJson(res, 500, { ok: false, error: 'internal error: ' + String(err?.message ?? err).slice(0, 400) });
      } else {
        res.destroy();
      }
    }),
  }));
}

async function handle(req, res, deps) {
  const { webServer } = deps;
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const route = pathname.slice('/plugin/mineru'.length) || '/';

  // Same-origin only: refuse requests carrying a foreign Origin header.
  const origin = req.headers.origin;
  if (origin) {
    const allowed = new Set([
      'http://' + webServer.host + ':' + webServer.port,
      'http://localhost:' + webServer.port,
      'http://127.0.0.1:' + webServer.port,
    ]);
    if (!allowed.has(origin)) {
      sendJson(res, 403, { ok: false, error: 'cross-origin request refused' });
      return;
    }
  }
  if (method === 'OPTIONS') {
    // No CORS headers: cross-origin preflights fail, same-origin calls proceed.
    sendEmpty(res, 204);
    return;
  }

  if (route === '/' && method === 'GET') {
    const facts = await deps.state.collectFacts();
    sendJson(res, 200, { ok: true, health: facts, plugin: 'dsh-mineru' });
    return;
  }
  if (route === '/config' && method === 'GET') {
    const descriptor = (deps.settings.describe({ redactSecrets: true }) ?? [])
      .find((d) => d.ns === 'mineru');
    const facts = await deps.state.collectFacts();
    sendJson(res, 200, {
      ok: true,
      revision: descriptor?.revision ?? 0,
      value: descriptor?.value ?? {},
      base: descriptor?.base ?? {},
      userOverrides: descriptor?.user ?? {},
      applies: descriptor?.applies ?? 'live',
      secrets: descriptor?.secrets ?? [],
      facts,
      schemaHints: {
        modes: ['auto', 'precision', 'agent'],
        modelVersions: ['pipeline', 'vlm', 'MinerU-HTML'],
        extraFormats: ['docx', 'html', 'latex'],
        languages: [
          'ch', 'ch_server', 'en', 'japan', 'korean', 'chinese_cht',
          'ta', 'te', 'ka', 'el', 'th',
          'latin', 'arabic', 'cyrillic', 'east_slavic', 'devanagari',
        ],
        defaults: DEFAULTS,
      },
    });
    return;
  }
  if (route === '/config' && method === 'POST') {
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { sendJson(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
    const patch = body && typeof body.patch === 'object' && body.patch !== null ? body.patch : null;
    if (!patch) { sendJson(res, 400, { ok: false, error: 'missing patch object' }); return; }
    try {
      await deps.settings.update('mineru', patch, Number.isInteger(body.expectedRevision) ? body.expectedRevision : undefined);
      const descriptor = (deps.settings.describe({ redactSecrets: true }) ?? []).find((d) => d.ns === 'mineru');
      sendJson(res, 200, { ok: true, revision: descriptor?.revision ?? 0 });
    } catch (err) {
      if (err instanceof SettingsConflictError) {
        sendJson(res, 409, { ok: false, conflict: true, error: '设置已被其他会话修改, 请刷新后重试.', currentRevision: err.actual });
      } else {
        sendJson(res, 400, { ok: false, error: String(err?.message ?? err).slice(0, 500) });
      }
    }
    return;
  }
  if (route === '/credential' && method === 'POST') {
    const raw = await readBody(req);
    let body;
    try { body = JSON.parse(raw || '{}'); } catch { sendJson(res, 400, { ok: false, error: 'invalid JSON body' }); return; }
    const cfg = deps.scope.get();
    const refName = typeof body.ref === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(body.ref) ? body.ref : cfg.tokenCredential;
    let ref;
    try {
      ref = (await import('@deepseek-ai/dsh-credentials')).credentialRef(refName);
    } catch {
      sendJson(res, 400, { ok: false, error: 'invalid credential reference' });
      return;
    }
    try {
      if (body.clear === true) {
        await deps.credentials.unset(ref);
      } else {
        const value = stripToken(body.value);
        if (value === undefined) { sendJson(res, 400, { ok: false, error: 'value 为空或过长 (1..4096 字符)' }); return; }
        await deps.credentials.set(ref, value);
      }
      const describe = await deps.credentials.describe(ref);
      sendJson(res, 200, { ok: true, ref: refName, configured: Boolean(describe?.configured) });
    } catch (err) {
      sendJson(res, 400, { ok: false, error: String(err?.message ?? err).slice(0, 400) });
    }
    return;
  }
  if (route === '/test-token' && method === 'POST') {
    const outcome = await testToken(deps);
    sendJson(res, outcome.status, outcome.body);
    return;
  }
  if (route === '/test-agent' && method === 'POST') {
    const outcome = await testAgent(deps);
    sendJson(res, outcome.status, outcome.body);
    return;
  }
  if (route === '/artifact' && method === 'GET') {
    await serveArtifact(req, res, deps, url);
    return;
  }
  if (route === '/upload' && method === 'POST') {
    await handleUpload(req, res, deps, url);
    return;
  }
  sendJson(res, 404, { ok: false, error: 'unknown route: ' + route });
}
/**
 * Token connection test: submits the official one-page demo PDF through the
 * precision API and polls briefly. Success proves the token works; this is an
 * explicit user action and consumes at most one page of the 1000-page daily
 * priority quota.
 */
async function testToken(deps) {
  const cfg = deps.scope.get();
  const client = await deps.state.clientFor(cfg);
  if (!client.precisionEnabled()) {
    return { status: 400, body: { ok: false, error: '未配置 MinerU Token: 请先在上方填写并保存 Token.' } };
  }
  const demo = 'https://cdn-mineru.openxlab.org.cn/demo/example.pdf';
  const opts = {
    language: cfg.language,
    enableTable: true,
    enableFormula: true,
    isOcr: false,
    modelVersion: 'vlm',
    pageRanges: undefined,
    pageRange: undefined,
    extraFormats: [],
    dataId: 'dsh-mineru-token-test',
    timeoutMs: 180000,
    pollIntervalMs: 2000,
    pollJitterMs: 200,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 185000);
  try {
    const outcome = await client.submitAndWaitUrl({
      url: demo,
      fileName: 'example.pdf',
      opts,
      api: 'precision',
      signal: controller.signal,
    });
    return {
      status: 200,
      body: {
        ok: true,
        message: 'Token 有效: 示例 PDF 解析成功 (taskId=' + outcome.taskId + '). 本次测试消耗约 1 页精准解析额度.',
      },
    };
  } catch (err) {
    const message = err instanceof MineruError ? err.message : String(err?.message ?? err);
    return { status: 400, body: { ok: false, error: message } };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Agent API availability test: submits the demo PDF through the tokenless
 * Agent lightweight API. Reports success or the current IP rate-limit state.
 */
async function testAgent(deps) {
  const cfg = deps.scope.get();
  const client = await deps.state.clientFor(cfg);
  const opts = {
    language: cfg.language,
    enableTable: true,
    enableFormula: true,
    isOcr: false,
    modelVersion: 'vlm',
    pageRanges: undefined,
    pageRange: undefined,
    extraFormats: [],
    dataId: undefined,
    timeoutMs: 180000,
    pollIntervalMs: 2000,
    pollJitterMs: 200,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 185000);
  try {
    const outcome = await client.submitAndWaitUrl({
      url: 'https://cdn-mineru.openxlab.org.cn/demo/example.pdf',
      fileName: 'example.pdf',
      opts,
      api: 'agent',
      signal: controller.signal,
    });
    return {
      status: 200,
      body: {
        ok: true,
        message: 'Agent 轻量解析 API 可用: 示例 PDF 解析成功 (taskId=' + outcome.taskId + ').',
      },
    };
  } catch (err) {
    const message = err instanceof MineruError ? err.message : String(err?.message ?? err);
    return { status: 400, body: { ok: false, error: message } };
  } finally {
    clearTimeout(timer);
  }
}

/** Serve one signed artifact. */
async function serveArtifact(req, res, deps, url) {
  const w = url.searchParams.get('w');
  const p = url.searchParams.get('p');
  const t = url.searchParams.get('t');
  const manager = deps.state.artifacts.managerByIndex(w);
  if (!manager) { sendJson(res, 404, { ok: false, error: 'workspace not found' }); return; }
  const check = manager.verifyCapability(w + '|' + p, t);
  if (!check.ok) { sendJson(res, 401, { ok: false, error: 'invalid capability token' }); return; }
  if (check.expired) { sendJson(res, 410, { ok: false, error: 'artifact link expired' }); return; }
  let info;
  try {
    info = await manager.resolveServe(p, { maxBytes: 256 << 20 });
  } catch (err) {
    const status = err instanceof ArtifactError && err.code === 'ARTIFACT_NOT_FOUND' ? 404 : 400;
    sendJson(res, status, { ok: false, error: String(err?.message ?? err) });
    return;
  }
  const disposition = inlineable(info.abs) ? 'inline' : 'attachment';
  res.writeHead(200, {
    'Content-Type': info.mime,
    'Content-Length': info.bytes,
    'Content-Disposition': disposition,
    'Cache-Control': 'private, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return; }
  const stream = createReadStream(info.abs);
  stream.on('error', () => { res.destroy(); });
  stream.pipe(res);
}

const UPLOAD_MAX_BYTES = 210 * 1024 * 1024; // precision limit (200MB) + margin
const UPLOAD_MEDIA = 'application/octet-stream';

function extOfPath(name) {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/**
 * POST /plugin/mineru/upload?sessionId=<id>&name=<file>
 * Raw octet-stream body streamed into <cwd>/.dsh-mineru/uploads/<stamp>/<name>.
 * The client sends this for drag-dropped documents/images so the file lands
 * inside the session workspace as a regular file (mineru_parse reads paths),
 * instead of riding the native image-attachment channel that text-only models
 * reject at prompt admission.
 */
async function handleUpload(req, res, deps, url) {
  const sessionId = url.searchParams.get('sessionId');
  const rawName = url.searchParams.get('name');
  if (!sessionId || !rawName) {
    sendJson(res, 400, { ok: false, error: 'missing sessionId or name' });
    return;
  }
  const name = (() => {
    try { return sanitizeFileName(rawName); } catch { return ''; }
  })();
  if (!name || !SUPPORTED_EXTENSIONS.includes(extOfPath(name))) {
    sendJson(res, 400, { ok: false, error: '不支持的文件类型: 仅支持 pdf/doc/docx/ppt/pptx/xls/xlsx/html 与 png/jpg/jpeg/jp2/webp/gif/bmp.' });
    return;
  }
  const ctype = String(req.headers['content-type'] ?? '').split(';')[0].trim();
  if (ctype && ctype !== UPLOAD_MEDIA && ctype !== 'application/json') {
    sendJson(res, 415, { ok: false, error: 'upload body must be application/octet-stream' });
    return;
  }
  // Resolve the session workspace through the live agent registry.
  const agent = deps.agents.get(sessionId);
  if (!agent) {
    sendJson(res, 404, { ok: false, error: '会话不存在或未激活 (sessionId=' + sessionId + ')' });
    return;
  }
  const cwd = agent.session?.header?.cwd;
  if (!cwd) {
    sendJson(res, 400, { ok: false, error: '会话没有工作区 (cwd 缺失)' });
    return;
  }
  const manager = await deps.state.artifacts.managerFor(cwd);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(manager.rootDir, 'uploads', stamp);
  await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  const stream = createWriteStream(target, { flags: 'wx' });
  let size = 0;
  let aborted = false;
  const fail = (status, message) => {
    aborted = true;
    stream.destroy();
    rm(target, { force: true }).catch(() => {});
    if (!res.headersSent) sendJson(res, status, { ok: false, error: message });
    else res.destroy();
  };
  stream.on('error', () => fail(500, '写入上传文件失败'));
  req.on('data', (chunk) => {
    if (aborted) return;
    size += chunk.length;
    if (size > UPLOAD_MAX_BYTES) {
      fail(413, '文件超过 200MB 上限 (精准解析 API 限制)');
      return;
    }
    if (!stream.write(chunk)) req.pause();
  });
  stream.on('drain', () => req.resume());
  req.on('end', () => {
    if (aborted) return;
    stream.end(async () => {
      try {
        if (size === 0) {
          await rm(target, { force: true });
          sendJson(res, 400, { ok: false, error: '文件为空' });
          return;
        }
        const st = await stat(target);
        sendJson(res, 200, { ok: true, path: target, bytes: st.size, name });
      } catch (err) {
        fail(500, '上传收尾失败: ' + String(err?.message ?? err).slice(0, 200));
      }
    });
  });
  req.on('error', () => {
    if (!aborted) {
      aborted = true;
      stream.destroy();
      rm(target, { force: true }).catch(() => {});
    }
  });
}
