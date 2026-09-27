/**
 * Auto-chunk orchestration: a precision request that asks for more pages than
 * one request may carry is split by `page_ranges`, polled chunk by chunk, and
 * merged back into one result.
 *
 * The MinerU client is replaced by a fake that mimics the two probed behaviours
 * the merge depends on: one batch per chunk (so a batch id exists per chunk) and
 * a `content_list.json` whose `page_idx` is renumbered from 0 for the requested
 * subset. No network, no real quota.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (def) => def,
}));

import { MineruError } from '../lib/mineru-client.js';
import { WorkspaceArtifactStore } from '../lib/artifacts.js';
import { buildParseTool } from '../lib/tools.js';

/** A byte-level PDF whose page tree claims `count` pages. */
function fakePdf(count) {
  return Buffer.from(
    '%PDF-1.7\n'
    + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids [] /Count ' + count + ' >>\nendobj\n'
    + '%%EOF\n',
    'latin1',
  );
}

/** Page list `from..to`. */
const pagesOf = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** How many pages one `page_ranges` string asks for. */
function pagesInSpec(spec) {
  return String(spec).split(',').reduce((total, part) => {
    const [start, end] = part.split('-').map(Number);
    return total + (end === undefined ? 1 : end - start + 1);
  }, 0);
}

const workspaces = [];

/** Temp workspace + a file it contains; returns { cwd, path }. */
async function makeWorkspace(name, bytes) {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-mineru-chunk-'));
  workspaces.push(cwd);
  const filePath = join(cwd, name);
  await writeFile(filePath, bytes);
  return { cwd, filePath };
}

/**
 * Fake MinerU client: one item per chunk, `content_list.json` renumbered from 0
 * for the requested subset, one image per chunk.
 */
function makeFakeClient() {
  const submissions = [];
  return {
    submissions,
    precisionEnabled: () => true,
    resolveApi: () => ({ api: 'precision', effectiveMode: 'precision' }),
    async checkLocalFile(filePath) {
      const info = await stat(filePath);
      return { size: info.size, ext: filePath.slice(filePath.lastIndexOf('.')) };
    },
    async submitAndWaitFile({ opts }) {
      const index = submissions.length + 1;
      submissions.push({ pageRanges: opts.pageRanges, dataId: opts.dataId });
      return {
        api: 'precision',
        taskId: 'task-' + index,
        batchId: 'batch-' + index,
        state: 'done',
        fullZipUrl: 'https://fake.invalid/result-' + index + '.zip',
      };
    },
    async collectPrecisionZip({ zipUrl, destDir, opts }) {
      const index = Number(String(zipUrl).replace(/\D/g, ''));
      const pages = pagesInSpec(opts.pageRanges);
      const contentList = Array.from({ length: pages }, (_, pageIdx) => ({
        type: 'text',
        page_idx: pageIdx,
        text: 'chunk ' + index + ' subset page ' + pageIdx,
      }));
      await mkdir(join(destDir, 'images'), { recursive: true });
      const contentListName = 'sample_content_list.json';
      const markdownName = 'full.md';
      const imageName = 'images/hash-' + index + '.jpg';
      await writeFile(join(destDir, contentListName), JSON.stringify(contentList));
      await writeFile(join(destDir, markdownName), '# chunk ' + index + '\n\nbody ' + index + '\n');
      await writeFile(join(destDir, imageName), 'image ' + index);
      return {
        zipPath: join(destDir, 'result.zip'),
        files: [
          { name: contentListName, path: join(destDir, contentListName), bytes: 0 },
          { name: markdownName, path: join(destDir, markdownName), bytes: 0 },
          { name: imageName, path: join(destDir, imageName), bytes: 0 },
        ],
        markdownEntry: { name: markdownName },
        markdownText: '# chunk ' + index + '\n\nbody ' + index + '\n',
        markdownBytes: 20,
        contentListEntry: { name: contentListName },
        layoutEntry: undefined,
      };
    },
    async collectSingle({ outcome, destDir, opts }) {
      return this.collectPrecisionZip({ zipUrl: outcome.fullZipUrl, destDir, opts });
    },
  };
}

/** Minimal plugin state: real artifact store, fake client, static config. */
function makeState(client) {
  const store = new WorkspaceArtifactStore({ artifactRootName: '.dsh-mineru' });
  const cfg = {
    mode: 'precision',
    modelVersion: 'vlm',
    language: 'ch',
    enableTable: true,
    enableFormula: true,
    isOcr: false,
    extraFormats: [],
    timeoutMs: 600000,
    pollIntervalMs: 1000,
    pollJitterMs: 0,
    maxFileBytes: 0,
    inlineMarkdownBytes: 12000,
  };
  return {
    getCfg: () => cfg,
    clientFor: async () => client,
    artifacts: store,
    urlBuilder: null,
  };
}

function makeExec(cwd) {
  return { signal: undefined, agent: { session: { header: { cwd } } } };
}

afterEach(async () => {
  while (workspaces.length > 0) await rm(workspaces.pop(), { recursive: true, force: true }).catch(() => {});
});

describe('mineru_parse auto-chunking', () => {
  it('splits a 201-page PDF into two page_ranges requests and merges them', async () => {
    const { cwd } = await makeWorkspace('long.pdf', fakePdf(201));
    const client = makeFakeClient();
    const tool = buildParseTool(makeState(client));

    const result = await tool.execute({ source: 'long.pdf' }, makeExec(cwd));

    // One request per chunk, each carrying its own page range and data_id.
    expect(client.submissions).toEqual([
      { pageRanges: '1-200', dataId: 'long.pdf-p1-200' },
      { pageRanges: '201', dataId: 'long.pdf-p201' },
    ]);
    expect(result.chunkCount).toBe(2);
    expect(result.chunks.map((chunk) => chunk.range)).toEqual(['1-200', '201']);
    expect(result.chunks.map((chunk) => chunk.pages)).toEqual([200, 1]);
    expect(result.chunks.map((chunk) => chunk.batchId)).toEqual(['batch-1', 'batch-2']);
    expect(result.chunks.every((chunk) => chunk.state === 'done' && chunk.durationMs >= 0)).toBe(true);
    expect(result.taskId).toBe(null);
    expect(result.warning).toContain('已自动分 2 片解析并合并结果');

    // Merged Markdown: both segments, in order, each labelled with its range.
    const merged = await readFile(join(result.runDir, 'full.md'), 'utf8');
    expect(merged.indexOf('<!-- chunk 1/2: pages 1-200 (batch_id batch-1) -->')).toBeLessThan(merged.indexOf('body 1'));
    expect(merged.indexOf('body 1')).toBeLessThan(merged.indexOf('<!-- chunk 2/2: pages 201 (batch_id batch-2) -->'));
    expect(merged.indexOf('<!-- chunk 2/2')).toBeLessThan(merged.indexOf('body 2'));
    expect(result.preview.markdown).toBe(merged);

    // Merged content list: subset indexes mapped back, continuous across chunks.
    const mergedList = JSON.parse(await readFile(join(result.runDir, 'content_list.json'), 'utf8'));
    expect(mergedList.map((block) => block.page_idx)).toEqual(pagesOf(0, 200));
    expect(mergedList[0].text).toBe('chunk 1 subset page 0');
    expect(mergedList[200].text).toBe('chunk 2 subset page 0');

    // Per-chunk raw output is kept, images are unioned at the run root.
    const chunkEntries = await readdir(join(result.runDir, 'chunks', 'chunk-1'));
    expect(chunkEntries).toContain('sample_content_list.json');
    expect(await readdir(join(result.runDir, 'chunks', 'chunk-1', 'images'))).toEqual([]);
    expect(await readdir(join(result.runDir, 'images'))).toEqual(['hash-1.jpg', 'hash-2.jpg']);

    // run.json carries the chunk bookkeeping; the tool result lists root files.
    const runJson = JSON.parse(await readFile(join(result.runDir, 'run.json'), 'utf8'));
    expect(runJson.chunkCount).toBe(2);
    expect(runJson.pagesPerRequest).toBe(200);
    expect(runJson.pagesRequested).toBe(201);
    expect(runJson.totalPages).toBe(201);
    expect(runJson.pageCountMethod).toBe('count');
    expect(runJson.chunks.map((chunk) => chunk.range)).toEqual(['1-200', '201']);
    expect(result.artifacts.map((artifact) => artifact.name).sort()).toEqual(['content_list.json', 'full.md', 'run.json']);
  });

  it('keeps one request when the page count is within the cap, leaving cloud page indexes alone', async () => {
    const { cwd } = await makeWorkspace('short.pdf', fakePdf(10));
    const client = makeFakeClient();
    const tool = buildParseTool(makeState(client));

    const result = await tool.execute({ source: 'short.pdf', pageRanges: '3-5' }, makeExec(cwd));

    // The raw spec goes to the server unchanged (no local rewrite of a spec
    // that needs no splitting).
    expect(client.submissions).toEqual([{ pageRanges: '3-5', dataId: undefined }]);
    expect(result.chunkCount).toBe(1);
    expect(result.chunks).toEqual([{
      index: 1,
      range: '3-5',
      pages: 3,
      batchId: 'batch-1',
      taskId: 'task-1',
      dataId: null,
      state: 'done',
      durationMs: expect.any(Number),
    }]);
    expect(result.taskId).toBe('task-1');
    expect(result.warning).toBe(null);
    expect(await readdir(join(result.runDir, 'chunks')).catch(() => [])).toEqual([]);
    // A single request keeps the cloud's own artifact names and its subset
    // `page_idx`; only a merged multi-chunk result is renumbered.
    const single = JSON.parse(await readFile(join(result.runDir, 'sample_content_list.json'), 'utf8'));
    expect(single.map((block) => block.page_idx)).toEqual([0, 1, 2]);
  });

  it('resolves a negative page range before splitting', async () => {
    const { cwd } = await makeWorkspace('long.pdf', fakePdf(300));
    const client = makeFakeClient();
    const tool = buildParseTool(makeState(client));

    const result = await tool.execute({ source: 'long.pdf', pageRanges: '2--2' }, makeExec(cwd));

    // "2--2" is pages 2..299 = 298 pages -> two chunks starting at page 2.
    expect(client.submissions.map((submission) => submission.pageRanges)).toEqual(['2-201', '202-299']);
    expect(result.chunks.map((chunk) => chunk.pages)).toEqual([200, 98]);
    const mergedList = JSON.parse(await readFile(join(result.runDir, 'content_list.json'), 'utf8'));
    expect(mergedList[0].page_idx).toBe(1); // first requested page is original page 2
    expect(mergedList[mergedList.length - 1].page_idx).toBe(298);
  });

  it('names the failing chunk and removes the run directory', async () => {
    const { cwd } = await makeWorkspace('long.pdf', fakePdf(201));
    const client = makeFakeClient();
    client.submitAndWaitFile = async ({ opts }) => {
      if (opts.pageRanges === '201') {
        throw new MineruError('云端解析失败：页数超出限制', 'MINERU_PARSE_FAILED', { rawCode: '-60006' });
      }
      return { api: 'precision', taskId: 'task-1', batchId: 'batch-1', state: 'done', fullZipUrl: 'https://fake.invalid/result-1.zip' };
    };
    const tool = buildParseTool(makeState(client));

    const error = await tool.execute({ source: 'long.pdf' }, makeExec(cwd)).catch((err) => err);

    expect(error).toBeInstanceOf(MineruError);
    expect(error.code).toBe('MINERU_PARSE_FAILED');
    expect(error.message).toContain('第 2/2 片（第 201 页）');
    expect(await readdir(join(cwd, '.dsh-mineru', 'artifacts'))).toEqual([]);
  });

  it('adds the reason when a format without a local page count hits the cap', async () => {
    const { cwd } = await makeWorkspace('report.docx', Buffer.from('not a pdf'));
    const client = makeFakeClient();
    client.submitAndWaitFile = async () => {
      throw new MineruError('MinerU 文件页数超过限制：精准解析 API 单次请求最多 200 页。', 'MINERU_PARSE_FAILED', { rawCode: '-60006' });
    };
    const tool = buildParseTool(makeState(client));

    const error = await tool.execute({ source: 'report.docx' }, makeExec(cwd)).catch((err) => err);

    expect(error.message).toContain('未自动分片的原因：该格式（docx/pptx 等）的页数只能由云端读出');
    expect(client.submissions).toEqual([]);
  });

  it('never splits the tokenless Agent path', async () => {
    const { cwd } = await makeWorkspace('long.pdf', fakePdf(201));
    const client = makeFakeClient();
    client.resolveApi = () => ({ api: 'agent', effectiveMode: 'agent' });
    client.submitAndWaitFile = async ({ opts, api }) => {
      client.submissions.push({ pageRanges: opts.pageRanges, dataId: opts.dataId, api });
      throw new MineruError('文件页数超出 Agent 轻量解析接口限制（20 页）', 'MINERU_API', { rawCode: '-30003' });
    };
    const tool = buildParseTool(makeState(client));

    const error = await tool.execute({ source: 'long.pdf', mode: 'agent' }, makeExec(cwd)).catch((err) => err);

    expect(client.submissions).toHaveLength(1);
    expect(client.submissions[0].pageRanges).toBe(undefined);
    expect(client.submissions[0].api).toBe('agent');
    expect(error.message).not.toContain('未自动分片的原因');
  });
});
