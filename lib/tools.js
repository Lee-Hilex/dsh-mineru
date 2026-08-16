/**
 * Tool definitions: mineru_activate (bootstrap), mineru_parse, mineru_batch_parse,
 * mineru_task. The three parsing tools mount per agent after activation (or
 * globally under exposeMode: always).
 * @module dsh-mineru/tools
 */
import { basename, extname, join, resolve as pathResolve } from 'node:path';
import { rm } from 'node:fs/promises';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { MineruError, resolveOptions, effectiveModelFor } from './mineru-client.js';
import { AGENT_UNSUPPORTED_EXTENSIONS, EXTRA_FORMAT_VALUES, LANGUAGE_VALUES, SUPPORTED_EXTENSIONS } from './config.js';
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
    pageRanges: { type: 'string', description: '精准解析页码范围, 逗号分隔: "2,4-6", 支持倒数页码 "2--2".' },
    pageRange: { type: 'string', description: 'Agent 轻量解析页码范围, 仅支持 from-to 或单页: "1-10".' },
    extraFormats: { type: 'array', items: { type: 'string', enum: EXTRA_FORMAT_VALUES }, description: '精准解析额外导出格式: docx / html / latex.' },
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
 * Orchestrate one single-document parse: resolve mode/api, validate source,
 * submit (URL or signature upload), wait, download, extract into a fresh run
 * dir, and build the canonical result value.
 * @param {object} input { source, args, cfg, exec, state }
 */
async function runSingleParse({ source, args, cfg, exec, state }) {
  const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
  const client = await state.clientFor(cfg);
  const { api, effectiveMode } = client.resolveApi(args.mode, cfg.mode);
  const opts = resolveOptions(cfg, args);

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

  let warning;
  if (api === 'precision') {
    const forced = effectiveModelFor(ext, opts.modelVersion);
    opts.modelVersion = forced.modelVersion;
    if (forced.forced) warning = 'HTML 源已自动使用 MinerU-HTML 模型 (忽略其他 modelVersion)';
  } else if (ext && AGENT_UNSUPPORTED_EXTENSIONS.includes(ext)) {
    throw new MineruError(
      'Agent 轻量解析 API 不支持 ' + ext + ' 文件: 请改用精准解析 API (mode=precision 并配置 Token).',
      'MINERU_UNSUPPORTED_TYPE',
    );
  }

  const manager = await state.artifacts.managerFor(cwd);
  const runBase = sanitizeFileName(args.output ?? (fileName ?? 'parse'));
  const { dir, relDir } = await manager.createRun(runBase);
  const started = Date.now();
  try {
    const outcome = urlSource
      ? await client.submitAndWaitUrl({ url: source, fileName, opts, api, signal: exec.signal })
      : await client.submitAndWaitFile({ filePath, fileName, opts, api, signal: exec.signal });
    const collected = await client.collectSingle({ outcome, destDir: dir, opts, signal: exec.signal });
    const durationMs = Date.now() - started;
    const metadata = {
      plugin: 'dsh-mineru',
      createdAt: new Date().toISOString(),
      source: urlSource ? source : filePath,
      sourceName: displayName,
      api, mode: effectiveMode, modelVersion: opts.modelVersion,
      taskId: outcome.taskId ?? null,
      batchId: outcome.batchId ?? null,
      state: 'done',
      durationMs,
      markdownBytes: collected.markdownBytes ?? null,
      warning: warning ?? null,
    };
    await manager.writeFile(dir, 'run.json', JSON.stringify(metadata, null, 2));
    const preview = truncateMarkdown(collected.markdownText, cfg.inlineMarkdownBytes);
    const artifacts = await manager.describeRun(relDir, state.urlBuilder ? { capabilityFor: (rel) => state.urlBuilder(cwd, rel) } : undefined);
    return {
      ok: true,
      api, mode: effectiveMode, modelVersion: opts.modelVersion,
      taskId: outcome.taskId ?? null,
      batchId: outcome.batchId ?? null,
      state: 'done',
      durationMs,
      sourceName: displayName,
      sourceKind: urlSource ? 'url' : 'file',
      sourceBytes: fileSize,
      runDir: dir,
      warning: warning ?? null,
      markdownBytes: collected.markdownBytes ?? null,
      preview,
      artifacts,
    };
  } catch (err) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

const ARTIFACT_ITEM_SCHEMA = { type: 'object', additionalProperties: false, properties: {
  name: { type: 'string' }, path: { type: 'string' }, rel: { type: 'string' },
  kind: { type: 'string' }, mime: { type: 'string' }, bytes: { type: 'number' }, url: { type: 'string' },
} };

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
    preview: { type: 'object', additionalProperties: false, properties: { markdown: { type: 'string' }, truncated: { type: 'boolean' }, bytes: { type: 'number' } } },
    artifacts: { type: 'array', items: ARTIFACT_ITEM_SCHEMA },
  },
};

function renderParseContent(value) {
  const lines = [
    'MinerU 解析完成 (' + value.api + ' API, ' + value.modelVersion + ', 耗时 ' + (value.durationMs / 1000).toFixed(1) + 's)',
    '- 任务: ' + value.taskId,
    '- 结果目录: ' + value.runDir,
  ];
  if (value.warning) lines.push('- 注意: ' + value.warning);
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
    description: '用 MinerU 解析单个文档为结构化 Markdown: 支持 PDF/Word(doc,docx)/PPT(ppt,pptx)/Excel(xls,xlsx)/HTML/图片(png,jpg,jpeg,jp2,webp,gif,bmp). source 为工作区文件路径或 http(s) URL. 已配置 Token 时默认走精准解析 API(<=200MB/<=200页, Zip 含 full.md+JSON+可加 docx/html/latex), 未配置 Token 时走 Agent 轻量解析 API(<=10MB/<=20页, 仅 Markdown). 结果落地到 <workspace>/.dsh-mineru/artifacts/<run>/ 并以 Artifact 列表返回.',
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
        doneCount += 1;
        const relItemDir = relDir.replace(/\\/g, '/') + '/' + safeName;
        const itemArtifacts = await manager.describeRun(relItemDir, state.urlBuilder ? { capabilityFor: (rel) => state.urlBuilder(cwd, rel) } : undefined);
        flatArtifacts.push(...itemArtifacts);
        results.push({ name: item.name, state: 'done', dir: itemDir, markdownBytes: collected.markdownBytes ?? null, artifacts: itemArtifacts });
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
        artifacts: [],
      };
      if (outcome.state !== 'done') return base;
      if (!collect) return base;
      const cwd = exec.agent?.session?.header?.cwd ?? process.cwd();
      const manager = await state.artifacts.managerFor(cwd);
      const { dir, relDir } = await manager.createRun(sanitizeFileName(args.output ?? 'task'));
      try {
        const collected = await client.collectSingle({ outcome, destDir: dir, opts: resolveOptions(cfg, { ...args, timeoutMs: args.timeoutMs }), signal: exec.signal });
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