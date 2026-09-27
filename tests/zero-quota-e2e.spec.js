/**
 * Zero-quota end-to-end tests: the REAL MineruClient and the REAL parse
 * orchestration run against a fake cloud injected at the fetch level (see
 * tests/helpers/fake-cloud.js) — no network, no per-page quota. These exercise
 * the whole submit -> signed upload -> poll -> download -> unzip -> merge path
 * (the existing tests only fake the high-level client methods), pin the network
 * behaviour (one upload / download per chunk, no silent re-upload), and replay a
 * real MinerU content_list to a byte-identical document.md.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (def) => def,
}));

import { DailyCounter, MineruClient, MineruError, RateLimiter } from '../lib/mineru-client.js';
import { WorkspaceArtifactStore } from '../lib/artifacts.js';
import { buildParseTool } from '../lib/tools.js';
import { makeFakeCloud } from './helpers/fake-cloud.js';
import { buildPdf, buildZip } from './helpers/zip.js';

const workspaces = [];

async function makeWorkspace(name, bytes) {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-mineru-e2e-'));
  workspaces.push(cwd);
  await writeFile(join(cwd, name), bytes);
  return cwd;
}

const makeExec = (cwd) => ({ signal: undefined, agent: { session: { header: { cwd } } } });

function makeState(client, overrides = {}) {
  const store = new WorkspaceArtifactStore({ artifactRootName: '.dsh-mineru' });
  const cfg = {
    mode: 'precision', modelVersion: 'vlm', language: 'ch',
    enableTable: true, enableFormula: true, isOcr: false, extraFormats: [],
    timeoutMs: 30000, pollIntervalMs: 1, pollJitterMs: 0,
    maxFileBytes: 0, inlineMarkdownBytes: 12000, ...overrides,
  };
  return { getCfg: () => cfg, clientFor: async () => client, artifacts: store, urlBuilder: null };
}

function realClient() {
  const limiters = {
    submit: new RateLimiter(40),
    poll: new RateLimiter(900),
    daily: new DailyCounter(5000),
  };
  return new MineruClient({
    baseUrl: 'https://mineru.net', token: 'tok-test', limiters, userAgent: 'dsh-mineru-test',
  });
}

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

afterEach(async () => {
  vi.unstubAllGlobals();
  while (workspaces.length > 0) {
    await rm(workspaces.pop(), { recursive: true, force: true }).catch(() => {});
  }
});

describe('fetch-level fake cloud — single precision request', () => {
  it('runs submit/upload/poll/download with the real client and counts every call', async () => {
    const pdf = buildPdf({ pages: 3 });
    const cwd = await makeWorkspace('small.pdf', pdf);
    const cloud = makeFakeCloud({ totalPages: 3, pollUntilDone: 2 });
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState(realClient()));

    const result = await tool.execute({ source: 'small.pdf', anchor: true }, makeExec(cwd));

    // Network shape: one submit, the whole source uploaded once, two polls
    // (running -> done), one zip download.
    expect(cloud.calls.submit).toHaveLength(1);
    expect(cloud.calls.upload).toHaveLength(1);
    expect(cloud.calls.poll).toHaveLength(2);
    expect(cloud.calls.download).toHaveLength(1);
    expect(cloud.calls.upload[0].bytes).toBe(pdf.length);
    expect(cloud.calls.submit[0].files[0].page_ranges).toBe(undefined);
    expect(result.chunkCount).toBe(1);

    // Anchors resolve physical pages p1..p3.
    const doc = await readFile(join(result.runDir, 'document.md'), 'utf8');
    for (const anchor of ['<!-- p1 b1 -->', '<!-- p2 b1 -->', '<!-- p3 b1 -->']) {
      expect(doc).toContain(anchor);
    }
  });
});

describe('fetch-level fake cloud — chunking over the cap', () => {
  it('chunks a 250-page PDF with one submit/upload/download per chunk and continuous anchors', async () => {
    const pdf = buildPdf({ pages: 250 });
    const cwd = await makeWorkspace('long.pdf', pdf);
    const cloud = makeFakeCloud({ totalPages: 250, pollUntilDone: 1 });
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState(realClient()));

    const result = await tool.execute({ source: 'long.pdf', anchor: true }, makeExec(cwd));

    expect(result.chunkCount).toBe(2);
    expect(cloud.calls.submit).toHaveLength(2);
    expect(cloud.calls.upload).toHaveLength(2);
    expect(cloud.calls.poll).toHaveLength(2);
    expect(cloud.calls.download).toHaveLength(2);
    expect(cloud.calls.submit.map((body) => body.files[0].page_ranges))
      .toEqual(['1-200', '201-250']);

    // Merged root content_list carries absolute page_idx; anchors run p1..p250.
    const list = JSON.parse(await readFile(join(result.runDir, 'content_list.json'), 'utf8'));
    const pageIdx = [...new Set(list.map((block) => block.page_idx))].sort((a, b) => a - b);
    expect(pageIdx).toEqual(Array.from({ length: 250 }, (_, i) => i));
    const doc = await readFile(join(result.runDir, 'document.md'), 'utf8');
    expect(doc).toContain('<!-- p1 b1 -->');
    expect(doc).toContain('<!-- p250 b1 -->');
    expect(doc).not.toContain('<!-- p?');
  });
});

describe('fetch-level fake cloud — failure handling', () => {
  it('fails the chunk matching a page spec, names it, downloads no zip for it, removes the run dir', async () => {
    const pdf = buildPdf({ pages: 250 });
    const cwd = await makeWorkspace('long.pdf', pdf);
    const cloud = makeFakeCloud({ totalPages: 250, pollUntilDone: 1, failSpecs: ['201-250'] });
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState(realClient()));

    const err = await tool.execute({ source: 'long.pdf' }, makeExec(cwd)).catch((e) => e);

    expect(err).toBeInstanceOf(MineruError);
    expect(err.message).toContain('第 2/2 片');
    expect(cloud.calls.submit).toHaveLength(2);
    expect(cloud.calls.download).toHaveLength(1); // only the first chunk downloaded
    expect(await readdir(join(cwd, '.dsh-mineru', 'artifacts'))).toEqual([]);
  });
});

describe('fetch-level fake cloud — malformed archives', () => {
  it('rejects a zip whose entry traverses the destination and removes the run dir', async () => {
    const evilZip = buildZip([{ name: '../evil.jpg', data: 'x' }]);
    const cwd = await makeWorkspace('small.pdf', buildPdf({ pages: 2 }));
    const cloud = makeFakeCloud({ totalPages: 2, pollUntilDone: 1, zipBytes: evilZip });
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState(realClient()));

    const err = await tool.execute({ source: 'small.pdf' }, makeExec(cwd)).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(String(err.code) + ' ' + err.message).toMatch(/zip|unsafe|穿越|非法/i);
    expect(await readdir(join(cwd, '.dsh-mineru', 'artifacts'))).toEqual([]);
  });

  it('rejects a truncated archive and removes the run dir', async () => {
    const truncated = buildZip([{ name: 'full.md', data: 'hello world' }]).subarray(0, 30);
    const cwd = await makeWorkspace('small.pdf', buildPdf({ pages: 2 }));
    const cloud = makeFakeCloud({ totalPages: 2, pollUntilDone: 1, zipBytes: truncated });
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState(realClient()));

    const err = await tool.execute({ source: 'small.pdf' }, makeExec(cwd)).catch((e) => e);

    expect(err).toBeInstanceOf(Error);
    expect(String(err.code) + ' ' + err.message).toMatch(/zip|eocd|invalid|损坏/i);
    expect(await readdir(join(cwd, '.dsh-mineru', 'artifacts'))).toEqual([]);
  });

  it('does not write document.md when the result zip has no content_list.json', async () => {
    const cwd = await makeWorkspace('small.pdf', buildPdf({ pages: 2 }));
    const cloud = makeFakeCloud({ totalPages: 2, pollUntilDone: 1, withContentList: false });
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState(realClient()));

    const result = await tool.execute({ source: 'small.pdf', anchor: true }, makeExec(cwd));

    expect(await exists(join(result.runDir, 'document.md'))).toBe(false);
    expect(JSON.stringify(result.anchor ?? result)).toMatch(/content_list/i);
  });
});

describe('fetch-level fake cloud — real product byte-exact replay', () => {
  it('replays a real 6-page content_list to a byte-identical document.md', async () => {
    const fixtureDir = join('tests', 'fixtures', 'real-bcgm-6p');
    const realList = JSON.parse(await readFile(join(fixtureDir, 'content_list.json'), 'utf8'));
    const cwd = await makeWorkspace('doc.pdf', buildPdf({ pages: 6 }));
    const cloud = makeFakeCloud({
      totalPages: 6, pollUntilDone: 1, contentList: realList, fileName: 'doc.pdf',
    });
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState(realClient()));

    const result = await tool.execute({ source: 'doc.pdf', anchor: true }, makeExec(cwd));

    const produced = await readFile(join(result.runDir, 'document.md'), 'utf8');
    const expected = await readFile(join(fixtureDir, 'expected-document.md'), 'utf8');
    expect(produced).toBe(expected);
  });
});
