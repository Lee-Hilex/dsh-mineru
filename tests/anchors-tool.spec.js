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

const dirs = [];

afterEach(async () => {
  while (dirs.length > 0) await rm(dirs.pop(), { recursive: true, force: true });
});

/**
 * @param {{withContentList?: boolean}} [options]
 * @returns {Promise<{cwd: string, state: object}>}
 */
async function makeHarness(options = {}) {
  const withContentList = options.withContentList !== false;
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-mineru-anchor-'));
  dirs.push(cwd);
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
      submitAndWaitFile: async () => ({ api: 'precision', taskId: 'task-1', state: 'done', fullZipUrl: 'https://example.invalid/result.zip' }),
      collectSingle: async ({ destDir }) => {
        await writeFile(join(destDir, 'full.md'), '# 云端 full.md\n');
        if (withContentList) {
          await writeFile(join(destDir, 'aaa_content_list.json'), JSON.stringify(CONTENT_LIST));
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
  const managerModule = await import('../lib/artifacts.js');
  const manager = new managerModule.ArtifactManager({ rootDir: join(cwd, '.dsh-mineru') });
  await manager.init();
  return { cwd, state };
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
