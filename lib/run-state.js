/**
 * Chunk-level run state, snapshots and resume decisions (pure functions plus a
 * few small file helpers).
 *
 * Why this exists: an over-limit precision parse is several `page_ranges`
 * requests. If the process is killed (or one chunk fails) after some chunks are
 * already parsed — and billed — re-running the same instruction must (1) find
 * the previous run by content, not a fresh timestamp dir, (2) align chunks by
 * their page spec, never array order, and (3) reuse finished chunks from a
 * snapshot or re-download them, re-submitting only chunks the cloud marked
 * failed. Nothing here re-uploads a finished chunk.
 * @module dsh-mineru/run-state
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const RUN_STATE_SCHEMA = 'dsh-mineru/run/1';

/** Written last inside a chunk snapshot; its absence means a half snapshot. */
export const CHUNK_MARKER = '.complete.json';

/** @param {Buffer | string} data @returns {string} hex sha256 */
export function sha256Of(data) {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Stable key for "the same source parsed with the same intent". sha256 alone is
 * insufficient: different page selections / models of one file must not collide.
 * @param {{ sha256: string, requestedSpec?: string|null, modelVersion?: string, isOcr?: boolean, language?: string }} input
 * @returns {string}
 */
export function buildRunCacheKey(input) {
  return [
    'api-v4',
    input.sha256,
    input.requestedSpec ?? 'all',
    input.modelVersion ?? 'vlm',
    input.isOcr ? 'ocr' : 'noocr',
    input.language ?? 'ch',
  ].join('|');
}

/**
 * Decide what to do given prior runs of this workspace.
 *
 * @param {{ runs: Array<{dir: string, meta: Record<string, unknown>, artifactsPresent: boolean}>, cacheKey: string }} input
 * @returns {{ action: 'fresh' | 'reuse' | 'resume', run: object | null }}
 *   reuse — done and artifacts present (zero network); resume — a partial /
 *   running run exists; fresh — nothing reusable (no match, done-but-missing, or
 *   failed).
 */
export function decideRunResume(input) {
  const matches = input.runs
    .filter((r) => r.meta && r.meta.cacheKey === input.cacheKey)
    .sort((a, b) => String(b.meta.createdAt ?? '').localeCompare(String(a.meta.createdAt ?? '')));
  if (matches.length === 0) return { action: 'fresh', run: null };
  for (const run of matches) {
    if (run.meta.status === 'done' && run.artifactsPresent) return { action: 'reuse', run };
  }
  for (const run of matches) {
    if (run.meta.status === 'partial' || run.meta.status === 'running') {
      return { action: 'resume', run };
    }
  }
  return { action: 'fresh', run: null };
}

/**
 * Index prior chunk records by their page spec. The spec string is the only
 * safe alignment key: array order silently mismatches when the requested spec
 * changes and would write one chunk's content under another chunk's pages.
 * @param {Array<Record<string, unknown>>} prevChunks
 * @returns {Map<string, Record<string, unknown>>}
 */
export function chunkResumeMap(prevChunks) {
  const map = new Map();
  for (const chunk of Array.isArray(prevChunks) ? prevChunks : []) {
    if (chunk && typeof chunk.range === 'string' && !map.has(chunk.range)) map.set(chunk.range, chunk);
  }
  return map;
}

/** @param {string} chunkDir @returns {string} */
export function chunkMarkerPath(chunkDir) {
  return join(chunkDir, CHUNK_MARKER);
}

/**
 * Persist a chunk snapshot marker (written after every entry is on disk).
 * @param {string} chunkDir
 * @param {{ batchId: string|null, contentListName: string|null, entries: string[] }} payload
 */
export async function writeChunkMarker(chunkDir, payload) {
  await writeFile(
    chunkMarkerPath(chunkDir),
    JSON.stringify({ ...payload, finishedAt: new Date().toISOString() }, null, 2) + '\n',
  );
}

/**
 * Read a chunk snapshot marker. Missing / unreadable -> null (caller treats it
 * as no snapshot).
 * @param {string} chunkDir
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function readChunkMarker(chunkDir) {
  try {
    return JSON.parse(await readFile(chunkMarkerPath(chunkDir), 'utf8'));
  } catch {
    return null;
  }
}
