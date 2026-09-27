/**
 * Chunk-level resume + billing protection, end to end.
 *
 * Unlike the class-level fakes in auto-chunk.spec.js, here a REAL MineruClient
 * runs against a fetch-level fake cloud, so the exact network accounting is
 * observable: how many files are submitted (billed), how many PUT uploads happen
 * (re-uploads), how many result downloads. The #8 guarantees under test:
 *
 *  - a finished chunk is reused from its snapshot (zero network) on re-run;
 *  - a done chunk whose snapshot is incomplete is re-downloaded via the ORIGINAL
 *    batch (poll + download), never re-uploaded;
 *  - only a cloud-failed chunk is re-submitted (new batch);
 *  - a finished run is reused with zero network; a changed model/selection is a
 *    fresh run (composite cache key).
 *
 * The file is self-contained (its own tiny STORED-zip builder and fake cloud)
 * so this branch does not depend on the separate test-assets PR.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { access, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (def) => def,
}));

import { MineruClient } from '../lib/mineru-client.js';
import { WorkspaceArtifactStore } from '../lib/artifacts.js';
import { buildParseTool } from '../lib/tools.js';

const exists = (p) => access(p).then(() => true).catch(() => false);

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

/* ---------------------------- tiny STORED zip ---------------------------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let crc = n;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[n] = crc >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const u16 = (n) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n >>> 0);
  return b;
};
const u32 = (n) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0);
  return b;
};

/** Build a STORED (method 0) zip from [{ name, data: Buffer }]. */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = Buffer.from(entry.data);
    const crc = crc32(data);
    const localHead = Buffer.concat([
      u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]);
    locals.push(localHead, data);
    const centralHead = Buffer.concat([
      u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
      u32(crc), u32(data.length), u32(data.length),
      u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
    ]);
    centrals.push(centralHead);
    offset += localHead.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(cd.length), u32(offset), u16(0),
  ]);
  return Buffer.concat([...locals, cd, eocd]);
}

/* ------------------------------ fake cloud ------------------------------- */

function pagesForSpec(spec) {
  const pages = [];
  for (const part of String(spec).split(',')) {
    const [start, end] = part.split('-').map(Number);
    if (end === undefined) pages.push(start);
    else for (let p = start; p <= end; p++) pages.push(p);
  }
  return pages;
}

function jsonResponse(obj) {
  return new Response(JSON.stringify(obj), { headers: { 'Content-Type': 'application/json' } });
}

/**
 * Fetch-level fake precision cloud. `opts.stateFor(seq, spec)` returns the
 * terminal state ('done' default) of the seq-th submitted batch.
 */
function makeFakeCloud(opts = {}) {
  const batches = new Map();
  let seq = 0;
  const counts = { submit: 0, upload: 0, poll: 0, download: 0 };

  function zipFor(batch) {
    const abs = pagesForSpec(batch.spec);
    const contentList = abs.map((absPage, i) => ({
      type: 'text', page_idx: i, text: 'abs page ' + absPage,
    }));
    const markdown = abs.map((absPage) => '# page ' + absPage).join('\n\n');
    return buildZip([
      { name: 'full.md', data: Buffer.from(markdown) },
      { name: 'sample_content_list.json', data: Buffer.from(JSON.stringify(contentList)) },
    ]);
  }

  async function fetchImpl(input, init = {}) {
    const url = new URL(typeof input === 'string' ? input : input.url);
    const method = String(init.method ?? 'GET').toUpperCase();

    if (url.pathname.endsWith('/api/v4/file-urls/batch') && method === 'POST') {
      seq += 1;
      const id = 'batch-' + seq;
      let spec = '';
      try {
        const body = JSON.parse(init.body);
        spec = body.files?.[0]?.page_ranges ?? '';
      } catch { /* keep '' */ }
      const state = opts.stateFor ? opts.stateFor(seq, spec) : 'done';
      batches.set(id, { spec, state });
      counts.submit += 1;
      return jsonResponse({ code: 0, data: { batch_id: id, file_urls: ['https://oss.test/' + id] } });
    }
    if (url.host === 'oss.test' && method === 'PUT') {
      counts.upload += 1;
      return new Response(null, { status: 200 });
    }
    const pollMatch = url.pathname.match(/extract-results\/batch\/(.+)$/);
    if (pollMatch && method === 'GET') {
      counts.poll += 1;
      const batch = batches.get(decodeURIComponent(pollMatch[1]));
      if (!batch) return jsonResponse({ code: -1, msg: 'unknown batch' });
      if (batch.state === 'failed') {
        return jsonResponse({
          code: 0,
          data: { extract_result: [{ file_name: 'long.pdf', state: 'failed', err_code: -60010, err_msg: 'cloud failed' }] },
        });
      }
      return jsonResponse({
        code: 0,
        data: { extract_result: [{ file_name: 'long.pdf', state: 'done', full_zip_url: 'https://cdn.test/' + pollMatch[1] }] },
      });
    }
    if (url.host === 'cdn.test' && method === 'GET') {
      counts.download += 1;
      const batch = batches.get(url.pathname.slice(1));
      return new Response(zipFor(batch), { headers: { 'Content-Type': 'application/zip' } });
    }
    return new Response('not found', { status: 404 });
  }

  return { fetch: fetchImpl, counts };
}

/* ------------------------------ test harness ----------------------------- */

const workspaces = [];

async function makeWorkspace(name, bytes) {
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-mineru-resume-'));
  workspaces.push(cwd);
  await writeFile(join(cwd, name), bytes);
  return { cwd };
}

function makeState() {
  const client = new MineruClient({ baseUrl: 'https://api.mineru.test', token: 'test-token' });
  const store = new WorkspaceArtifactStore({ artifactRootName: '.dsh-mineru' });
  const cfg = {
    mode: 'precision', modelVersion: 'vlm', language: 'ch',
    enableTable: true, enableFormula: true, isOcr: false, extraFormats: [],
    timeoutMs: 600000, pollIntervalMs: 1, pollJitterMs: 0,
    maxFileBytes: 0, inlineMarkdownBytes: 12000,
  };
  return { getCfg: () => cfg, clientFor: async () => client, artifacts: store, urlBuilder: null };
}

const makeExec = (cwd) => ({ signal: undefined, agent: { session: { header: { cwd } } } });
const artifactsDirOf = (cwd) => join(cwd, '.dsh-mineru', 'artifacts');

afterEach(async () => {
  vi.unstubAllGlobals();
  while (workspaces.length > 0) await rm(workspaces.pop(), { recursive: true, force: true }).catch(() => {});
});

describe('chunk-level resume + billing protection', () => {
  it('re-runs only the failed chunk: finished chunk from snapshot, no re-upload', async () => {
    const { cwd } = await makeWorkspace('long.pdf', fakePdf(201));
    const cloud = makeFakeCloud({ stateFor: (seq) => (seq === 2 ? 'failed' : 'done') });
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState());

    // First attempt: chunk 1 done, chunk 2 failed -> partial.
    const err = await tool.execute({ source: 'long.pdf' }, makeExec(cwd)).catch((e) => e);
    expect(err.code).toBe('MINERU_PARSE_FAILED');
    expect(cloud.counts).toMatchObject({ submit: 2, upload: 2, poll: 2, download: 1 });

    // The finished chunk's raw zip is kept (salvage / billing protection).
    const partialName = (await readdir(artifactsDirOf(cwd)))[0];
    const partialDir = join(artifactsDirOf(cwd), partialName);
    expect(await exists(join(partialDir, 'chunks', 'chunk-1', 'result.zip'))).toBe(true);

    // Re-run: chunk 1 snapshot (zero network), chunk 2 re-submitted as batch-3.
    const result = await tool.execute({ source: 'long.pdf' }, makeExec(cwd));
    expect(result.chunkCount).toBe(2);
    expect(cloud.counts.submit).toBe(3);
    expect(cloud.counts.upload).toBe(3);   // chunk 1 was NOT re-uploaded
    expect(cloud.counts.download).toBe(2); // batch-1 first run, batch-3 now
    expect(result.chunks[0].resumed).toBe('snapshot');
    expect(result.chunks[1].resumed).toBe('submit');

    // Merged content list is continuous over the original 201 pages.
    const list = JSON.parse(await readFile(join(result.runDir, 'content_list.json'), 'utf8'));
    expect(list.map((block) => block.page_idx)).toEqual(Array.from({ length: 201 }, (_, i) => i));
    expect(list[200].text).toBe('abs page 201');

    // Success removed the raw per-chunk zips.
    expect(await exists(join(result.runDir, 'chunks', 'chunk-1', 'result.zip'))).toBe(false);
  });

  it('reuses a finished run with zero network', async () => {
    const { cwd } = await makeWorkspace('long.pdf', fakePdf(201));
    const cloud = makeFakeCloud();
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState());

    await tool.execute({ source: 'long.pdf' }, makeExec(cwd));
    const afterFirst = { ...cloud.counts };

    const second = await tool.execute({ source: 'long.pdf' }, makeExec(cwd));
    expect(second.reused).toBe(true);
    expect(cloud.counts).toEqual(afterFirst); // no new network calls
  });

  it('re-downloads a done chunk from the original batch when its snapshot is incomplete (no upload)', async () => {
    const { cwd } = await makeWorkspace('long.pdf', fakePdf(201));
    const cloud = makeFakeCloud({ stateFor: (seq) => (seq === 2 ? 'failed' : 'done') });
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState());

    await tool.execute({ source: 'long.pdf' }, makeExec(cwd)).catch((e) => e);
    const partialName = (await readdir(artifactsDirOf(cwd)))[0];
    const partialDir = join(artifactsDirOf(cwd), partialName);
    // Corrupt chunk 1: keep the marker but remove an entry it lists.
    await rm(join(partialDir, 'chunks', 'chunk-1', 'full.md'));
    const before = { ...cloud.counts };

    const result = await tool.execute({ source: 'long.pdf' }, makeExec(cwd));
    // chunk 1: poll + re-download (NO upload); chunk 2: new batch (submit/upload).
    expect(cloud.counts.upload).toBe(before.upload + 1);
    expect(cloud.counts.download).toBe(before.download + 2);
    expect(result.chunks[0].resumed).toBe('redownload');
    expect(result.chunks[1].resumed).toBe('submit');
  });

  it('starts fresh when a model parameter differs (composite cache key)', async () => {
    const { cwd } = await makeWorkspace('long.pdf', fakePdf(201));
    const cloud = makeFakeCloud();
    vi.stubGlobal('fetch', cloud.fetch);
    const tool = buildParseTool(makeState());

    await tool.execute({ source: 'long.pdf' }, makeExec(cwd));
    const before = { ...cloud.counts };

    const second = await tool.execute({ source: 'long.pdf', modelVersion: 'pipeline' }, makeExec(cwd));
    expect(second.reused).toBeUndefined();
    expect(await readdir(artifactsDirOf(cwd))).toHaveLength(2);
    // A whole new 2-chunk run, not a resume of the vlm run.
    expect(cloud.counts.submit).toBe(before.submit + 2);
    expect(cloud.counts.upload).toBe(before.upload + 2);
  });
});
