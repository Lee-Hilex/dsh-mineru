/**
 * `anchor: true` end-to-end wiring for `mineru_parse`.
 *
 * The fake client stands in for the cloud: it writes the same files
 * `collectSingle` would extract, so the test exercises the real
 * `content_list.json` -> `document.md` path without touching MinerU (every
 * cloud call costs quota — see AGENTS.md).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (def) => def,
}));

import { buildParseTool } from '../lib/tools.js';

const CONTENT_LIST = [
  { type: 'text', text: '君子务本，本立而道生。', bbox: [114, 105, 544, 122], page_idx: 0 },
  { type: 'image', img_path: 'images/abc.jpg', bbox: [100, 300, 400, 500], page_idx: 1 },
];

/** Front matter `i`, body `1` from physical page 7, offprint `105` from 107. */
const THREE_SEGMENTS = [
  { from: 1, to: 6, label: 'i' },
  { from: 7, to: 106, start: 1 },
  { from: 107, to: 132, start: 105 },
];

const dirs = [];

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop(), { recursive: true, force: true });
});

/**
 * @param {{withContentList?: boolean, contentList?: object[]}} [options]
 * @returns {Promise<{cwd: string, state: object, calls: {submits: number}}>}
 */
async function makeHarness(options = {}) {
  const withContentList = options.withContentList !== false;
  const contentList = options.contentList ?? CONTENT_LIST;
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-mineru-anchor-'));
  dirs.push(cwd);
  const calls = { submits: 0 };
  const managerModule = await import('../lib/artifacts.js');
  const manager = new managerModule.ArtifactManager({ rootDir: join(cwd, '.dsh-mineru') });
  await manager.init();
  const state = {
    getCfg: () => ({
      mode: 'auto',
      modelVersion: 'vlm',
      language: 'ch',
      enableTable: true,
      enableFormula: true,
      isOcr: false,
      extraFormats: [],
      timeoutMs: 60000,
      pollIntervalMs: 100,
      pollJitterMs: 0,
      inlineMarkdownBytes: 12000,
      artifactRootName: '.dsh-mineru',
    }),
    clientFor: async () => ({
      resolveApi: () => ({ api: 'precision', effectiveMode: 'precision' }),
      checkLocalFile: async () => ({ size: 3, ext: '.pdf' }),
      submitAndWaitFile: async () => {
        calls.submits += 1;
        return { api: 'precision', taskId: 'task-1', state: 'done', fullZipUrl: 'https://example.invalid/result.zip' };
      },
      collectSingle: async ({ destDir }) => {
        await writeFile(join(destDir, 'full.md'), '# 云端 full.md\n');
        if (withContentList) {
          await writeFile(join(destDir, 'aaa_content_list.json'), JSON.stringify(contentList));
        }
        return {
          markdownText: '# 云端 full.md\n',
          markdownBytes: 20,
          contentListEntry: withContentList ? { name: 'aaa_content_list.json', path: join(destDir, 'aaa_content_list.json') } : undefined,
        };
      },
    }),
    artifacts: {
      managerFor: async () => manager,
    },
  };
  return { cwd, state, calls };
}

function execFor(cwd) {
  return { agent: { session: { header: { cwd } } }, signal: undefined };
}

describe('mineru_parse anchor option', () => {
  it('declares an optional boolean anchor parameter (default false)', () => {
    const tool = buildParseTool({ getCfg: () => ({}) });
    expect(tool.parameters.anchor.type).toBe('boolean');
    expect(tool.parameters.anchor.required).toBeUndefined();
  });

  it('writes document.md next to full.md and lists it as an artifact', async () => {
    const { cwd, state } = await makeHarness();
    const tool = buildParseTool(state);
    const result = await tool.execute({ source: 'doc.pdf', anchor: true }, execFor(cwd));

    expect(result.anchor.written).toBe(true);
    expect(result.anchor.blocks).toBe(2);
    expect(result.anchor.pages).toBe(2);
    expect(result.artifacts.map((a) => a.name)).toContain('document.md');

    const markdown = await readFile(join(result.runDir, 'document.md'), 'utf8');
    expect(markdown).toContain('<!-- p1 b1 -->\n君子务本，本立而道生。');
    expect(markdown).toContain('<!-- p2 b1 -->\n![image](images/abc.jpg)');
    // the existing artifacts keep their shape
    expect(await readFile(join(result.runDir, 'full.md'), 'utf8')).toBe('# 云端 full.md\n');
  });

  it('leaves the run directory untouched when anchor is off', async () => {
    const { cwd, state } = await makeHarness();
    const tool = buildParseTool(state);
    const result = await tool.execute({ source: 'doc.pdf' }, execFor(cwd));

    expect(result.anchor).toBeNull();
    expect(result.artifacts.map((a) => a.name)).not.toContain('document.md');
    await expect(readFile(join(result.runDir, 'document.md'), 'utf8')).rejects.toThrow();
  });

  it('warns instead of failing when the result has no content_list.json (Agent API)', async () => {
    const { cwd, state } = await makeHarness({ withContentList: false });
    const tool = buildParseTool(state);
    const result = await tool.execute({ source: 'doc.pdf', anchor: true }, execFor(cwd));

    expect(result.anchor.written).toBe(false);
    expect(result.anchor.document).toBeNull();
    expect(result.anchor.warnings.join('')).toContain('content_list.json');
    expect(result.ok).toBe(true);
  });

  it('surfaces the anchored document in the rendered tool output', async () => {
    const { cwd, state } = await makeHarness();
    const tool = buildParseTool(state);
    const result = await tool.execute({ source: 'doc.pdf', anchor: true }, execFor(cwd));
    const blocks = tool.output.render({}, result);
    expect(blocks[0].text).toContain('document.md');
  });

  it('reports the printed-page self-check in the anchor summary', async () => {
    const { cwd, state } = await makeHarness();
    const tool = buildParseTool(state);
    const result = await tool.execute({ source: 'doc.pdf', anchor: true }, execFor(cwd));
    // this fixture carries no page_number block, so nothing was detected
    expect(result.anchor.pageNumbers).toEqual({ detected: 0, total: 2, offsets: [] });
  });
});

describe('mineru_parse segments option', () => {
  it('writes page-map.json on its own and lists it as an artifact', async () => {
    const { cwd, state } = await makeHarness();
    const tool = buildParseTool(state);
    const result = await tool.execute({ source: 'doc.pdf', segments: THREE_SEGMENTS }, execFor(cwd));

    expect(result.anchor).toBeNull();
    expect(result.pageMap.written).toBe(true);
    expect(result.artifacts.map((a) => a.name)).toContain('page-map.json');
    const map = JSON.parse(await readFile(join(result.runDir, 'page-map.json'), 'utf8'));
    expect(map.version).toBe(1);
    expect(map.segments).toEqual(THREE_SEGMENTS);
    expect(map.pages).toHaveLength(132);
    expect(map.pages[0]).toEqual({ page: 1, label: 'i', segment: 1 });
    expect(map.pages[106]).toEqual({ page: 107, label: '105', segment: 3 });
    // the fixture is a two-page document, so the declaration reaches past it
    expect(map.pageRange).toEqual({ first: 1, last: 2 });
    expect(map.uncoveredPages).toEqual([]);
    expect(map.outOfRangePages).toHaveLength(130);
    expect(map.warnings.join('')).toContain('第 3-132 页');
    // no document.md unless `anchor` asked for it
    await expect(readFile(join(result.runDir, 'document.md'), 'utf8')).rejects.toThrow();
  });

  it('renders one > 印刷页码 line per page when anchor is on, and keeps the anchors', async () => {
    const { cwd, state } = await makeHarness();
    const tool = buildParseTool(state);
    const plain = await tool.execute({ source: 'doc.pdf', anchor: true }, execFor(cwd));
    const labelled = await tool.execute(
      { source: 'doc.pdf', anchor: true, segments: [{ from: 1, to: 2, label: 'i' }] },
      execFor(cwd),
    );

    const withLabels = await readFile(join(labelled.runDir, 'document.md'), 'utf8');
    expect(withLabels).toContain('> 印刷页码：i\n\n<!-- p1 b1 -->');
    expect(withLabels).toContain('> 印刷页码：ii\n\n<!-- p2 b1 -->');
    expect(labelled.pageMap.warnings).toEqual([]);
    expect(labelled.artifacts.map((a) => a.name)).toEqual(expect.arrayContaining(['document.md', 'page-map.json']));

    // Removing the label chunks gives back exactly the document rendered without
    // a declaration: the `<!-- pN bK -->` anchors are not touched.
    const withoutLabels = await readFile(join(plain.runDir, 'document.md'), 'utf8');
    expect(withLabels.replace(/^> 印刷页码：[^\n]*\n\n/gm, '')).toBe(withoutLabels);
  });

  it('stays silent when the declaration agrees with the printed numbers', async () => {
    const { cwd, state } = await makeHarness({
      contentList: [
        { type: 'text', text: '正文', page_idx: 0 },
        { type: 'page_number', text: '105', bbox: [521, 938, 547, 952], page_idx: 0 },
      ],
    });
    const tool = buildParseTool(state);
    const result = await tool.execute(
      { source: 'doc.pdf', anchor: true, segments: [{ from: 1, to: 1, label: '105' }] },
      execFor(cwd),
    );

    expect(result.anchor.pageNumbers.mismatches).toEqual([]);
    expect(result.pageMap.warnings).toEqual([]);
    expect(result.anchor.warnings).toEqual([]);
  });

  it('names the mismatching page once, in the page-map summary', async () => {
    const { cwd, state } = await makeHarness({
      contentList: [
        { type: 'text', text: '正文', page_idx: 0 },
        { type: 'page_number', text: '104', bbox: [521, 938, 547, 952], page_idx: 0 },
      ],
    });
    const tool = buildParseTool(state);
    const result = await tool.execute(
      { source: 'doc.pdf', anchor: true, segments: [{ from: 1, to: 1, label: '105' }] },
      execFor(cwd),
    );

    expect(result.pageMap.warnings).toHaveLength(1);
    expect(result.pageMap.warnings[0]).toContain('第 1 页声明为 105，云端识别为 104');
    // the declaration's own warning is not repeated on the anchor summary
    expect(result.anchor.warnings).toEqual([]);
  });

  it('still writes the map, with a note, when the result has no content_list.json', async () => {
    const { cwd, state } = await makeHarness({ withContentList: false });
    const tool = buildParseTool(state);
    const result = await tool.execute({ source: 'doc.pdf', anchor: true, segments: THREE_SEGMENTS }, execFor(cwd));

    expect(result.pageMap.written).toBe(true);
    expect(result.pageMap.warnings.join('')).toContain('无法判定');
    expect(result.anchor.written).toBe(false);
    const map = JSON.parse(await readFile(join(result.runDir, 'page-map.json'), 'utf8'));
    expect(map.pageRange).toBeNull();
    expect(map.pages).toHaveLength(132);
  });

  it('rejects a malformed declaration before anything is submitted', async () => {
    const { cwd, state, calls } = await makeHarness();
    const tool = buildParseTool(state);

    await expect(tool.execute(
      { source: 'doc.pdf', segments: [{ from: 10, to: 20, start: 1 }, { from: 15, to: 30, start: 1 }] },
      execFor(cwd),
    )).rejects.toThrow(/重叠/);
    await expect(tool.execute(
      { source: 'doc.pdf', segments: [{ from: 1, to: 6 }] },
      execFor(cwd),
    )).rejects.toThrow(/必须给 label 或 start/);
    expect(calls.submits).toBe(0);
  });

  it('surfaces the page map in the rendered tool output', async () => {
    const { cwd, state } = await makeHarness();
    const tool = buildParseTool(state);
    const result = await tool.execute({ source: 'doc.pdf', segments: THREE_SEGMENTS }, execFor(cwd));
    const blocks = tool.output.render({}, result);
    expect(blocks[0].text).toContain('- 页码体系: ');
    expect(blocks[0].text).toContain('page-map.json');
    expect(blocks[0].text).toContain('- 页码体系提示: ');
  });
});
