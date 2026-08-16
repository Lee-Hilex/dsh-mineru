/**
 * Minimal dependency-free ZIP reader for MinerU result archives.
 *
 * Supports the formats MinerU's CDN actually produces: single-disk zips with
 * STORED (0) and DEFLATE (8) entries. Reads the End Of Central Directory, walks
 * central directory records, and extracts entries with traversal-safe name
 * sanitization and byte caps. ZIP64 and encrypted entries fail loudly instead
 * of being misparsed.
 * @module dsh-mineru/zip
 */
import { open } from 'node:fs/promises';
import { createInflateRaw, inflateRawSync, constants as zlibConstants } from 'node:zlib';
import { dirname, join, resolve, sep } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const EOCD_SIGNATURE = 0x06054b50;
const EOCD_MIN_SIZE = 22;
const EOCD_MAX_COMMENT = 0xffff;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

/** @param {number} v @param {number} at @returns {number} little-endian uint32 */
function u32(view, at) { return view.readUInt32LE(at); }
/** @param {number} v @param {number} at @returns {number} little-endian uint16 */
function u16(view, at) { return view.readUInt16LE(at); }

/** Standard CRC-32 (IEEE, as stored in ZIP entries), table-driven. */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let crc = n;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[n] = crc >>> 0;
  }
  return table;
})();

/** @param {Buffer} buf @returns {number} */
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Stream-decompress at most maxBytes of output from a deflate entry without
 * loading the whole compressed stream. A truncated stream (as produced by
 * bounded reads) yields its partial output instead of throwing.
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {number} start absolute data start offset
 * @param {number} compressedSize
 * @param {number} maxBytes
 * @param {AbortSignal} [signal]
 * @returns {Promise<Buffer>}
 */
async function inflatePrefix(fh, start, compressedSize, maxBytes, signal) {
  const inflate = createInflateRaw();
  const chunks = [];
  let out = 0;
  let settled = false;
  const finish = () => { settled = true; };
  inflate.on('data', (chunk) => {
    if (out >= maxBytes) return;
    const take = Math.min(chunk.length, maxBytes - out);
    if (take > 0) { chunks.push(chunk.subarray(0, take)); out += take; }
    if (out >= maxBytes) { finish(); inflate.destroy(); }
  });
  inflate.on('error', finish);
  inflate.on('end', finish);
  const CHUNK = 1 << 16;
  let pos = 0;
  while (pos < compressedSize && !settled) {
    checkAbort(signal);
    const len = Math.min(CHUNK, compressedSize - pos);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start + pos);
    pos += len;
    inflate.write(buf);
  }
  if (!settled) inflate.end();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return Buffer.concat(chunks);
}

export class ZipError extends Error {
  constructor(message, code = 'ZIP_ERROR') {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

function checkAbort(signal) {
  if (signal?.aborted) {
    const err = new Error('zip operation aborted');
    err.name = 'AbortError';
    throw err;
  }
}

/**
 * Locate and parse the End Of Central Directory record.
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {number} fileSize
 * @param {AbortSignal} [signal]
 * @returns {Promise<{cdOffset:number, cdSize:number, entryCount:number}>}
 */
async function readEocd(fh, fileSize, signal) {
  if (fileSize < EOCD_MIN_SIZE) throw new ZipError('file too small to be a zip archive');
  const tailSize = Math.min(fileSize, EOCD_MIN_SIZE + EOCD_MAX_COMMENT);
  const buf = Buffer.alloc(tailSize);
  await fh.read(buf, 0, tailSize, fileSize - tailSize);
  checkAbort(signal);
  let found = -1;
  for (let i = tailSize - EOCD_MIN_SIZE; i >= 0; i--) {
    if (u32(buf, i) === EOCD_SIGNATURE) { found = i; break; }
  }
  if (found < 0) throw new ZipError('end of central directory not found');
  const diskNumber = u16(buf, found + 4);
  const cdDisk = u16(buf, found + 6);
  const diskEntries = u16(buf, found + 8);
  const totalEntries = u16(buf, found + 10);
  const cdSize = u32(buf, found + 12);
  const cdOffset = u32(buf, found + 16);
  if (diskNumber !== 0 || cdDisk !== 0 || diskEntries !== totalEntries) {
    throw new ZipError('multi-disk zip archives are not supported', 'ZIP_UNSUPPORTED');
  }
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('ZIP64 archives are not supported by the built-in extractor', 'ZIP_UNSUPPORTED');
  }
  return { cdOffset, cdSize, entryCount: totalEntries };
}

/** @typedef {{name:string, method:number, flags:number, compressedSize:number, uncompressedSize:number, localOffset:number, crc32:number, externalAttr:number}} ZipEntry */

/**
 * Read the central directory.
 * @param {import('node:fs/promises').FileHandle} fh
 * @param {number} cdOffset
 * @param {number} cdSize
 * @param {number} entryCount
 * @param {AbortSignal} [signal]
 * @returns {Promise<ZipEntry[]>}
 */
async function readCentralDirectory(fh, cdOffset, cdSize, entryCount, signal) {
  const buf = Buffer.alloc(cdSize);
  await fh.read(buf, 0, cdSize, cdOffset);
  checkAbort(signal);
  const entries = [];
  let at = 0;
  for (let n = 0; n < entryCount; n++) {
    if (at + 46 > cdSize || u32(buf, at) !== CENTRAL_SIGNATURE) {
      throw new ZipError('corrupt central directory record ' + n, 'ZIP_CORRUPT');
    }
    const flags = u16(buf, at + 8);
    const method = u16(buf, at + 10);
    const crc32 = u32(buf, at + 16);
    const compressedSize = u32(buf, at + 20);
    const uncompressedSize = u32(buf, at + 24);
    const nameLen = u16(buf, at + 28);
    const extraLen = u16(buf, at + 30);
    const commentLen = u16(buf, at + 32);
    const externalAttr = u32(buf, at + 38);
    const localOffset = u32(buf, at + 42);
    if (at + 46 + nameLen + extraLen + commentLen > cdSize) {
      throw new ZipError('corrupt central directory name for entry ' + n, 'ZIP_CORRUPT');
    }
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError('ZIP64 entries are not supported (' + name + ')', 'ZIP_UNSUPPORTED');
    }
    entries.push({ name, method, flags, compressedSize, uncompressedSize, localOffset, crc32, externalAttr });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/**
 * Sanitize one archive entry name into a relative path, rejecting traversal.
 * @param {string} name
 * @returns {string}
 */
export function sanitizeEntryName(name) {
  if (typeof name !== 'string' || name.length === 0) throw new ZipError('empty entry name');
  let p = name.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(p) || p.startsWith('/') || p.startsWith('//')) {
    throw new ZipError('entry with absolute path rejected: ' + name, 'ZIP_UNSAFE');
  }
  const parts = p.split('/');
  const out = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new ZipError('entry with parent traversal rejected: ' + name, 'ZIP_UNSAFE');
    out.push(part);
  }
  if (out.length === 0) throw new ZipError('entry resolves to empty path: ' + name, 'ZIP_UNSAFE');
  return out.join('/');
}

/**
 * Extract every safe entry of a zip file into destDir.
 * @param {string} zipPath
 * @param {string} destDir
 * @param {{signal?: AbortSignal, maxEntries?: number, maxTotalBytes?: number, maxEntryBytes?: number}} [opts]
 * @returns {Promise<{files: {name:string, path:string, bytes:number}[], totalBytes:number}>}
 */
export async function extractZip(zipPath, destDir, opts = {}) {
  const signal = opts.signal;
  const maxEntries = opts.maxEntries ?? 4096;
  const maxTotalBytes = opts.maxTotalBytes ?? (1 << 30);
  const maxEntryBytes = opts.maxEntryBytes ?? (256 << 20);
  const fh = await open(zipPath, 'r');
  let fileSize = 0;
  try {
    fileSize = (await fh.stat()).size;
    const eocd = await readEocd(fh, fileSize, signal);
    if (eocd.entryCount > maxEntries) throw new ZipError('too many zip entries: ' + eocd.entryCount, 'ZIP_TOO_MANY');
    const entries = await readCentralDirectory(fh, eocd.cdOffset, eocd.cdSize, eocd.entryCount, signal);
    const files = [];
    let totalBytes = 0;
    for (const entry of entries) {
      checkAbort(signal);
      const rel = sanitizeEntryName(entry.name);
      const isDir = entry.name.endsWith('/') || (entry.externalAttr & 0x10) !== 0;
      if (isDir) continue;
      if (entry.method !== 0 && entry.method !== 8) {
        throw new ZipError('unsupported compression method ' + entry.method + ' for ' + entry.name, 'ZIP_UNSUPPORTED');
      }
      if ((entry.flags & 0x1) !== 0) {
        throw new ZipError('encrypted zip entries are not supported: ' + entry.name, 'ZIP_UNSUPPORTED');
      }
      if (entry.uncompressedSize > maxEntryBytes) {
        throw new ZipError('zip entry too large: ' + entry.name + ' (' + entry.uncompressedSize + ' bytes)', 'ZIP_TOO_LARGE');
      }
      if (totalBytes + entry.uncompressedSize > maxTotalBytes) {
        throw new ZipError('zip extraction exceeds ' + maxTotalBytes + ' bytes total', 'ZIP_TOO_LARGE');
      }
      // Local file header: 30 fixed bytes + name + extra.
      const localHead = Buffer.alloc(30);
      await fh.read(localHead, 0, 30, entry.localOffset);
      checkAbort(signal);
      if (u32(localHead, 0) !== LOCAL_SIGNATURE) {
        throw new ZipError('corrupt local header for ' + entry.name, 'ZIP_CORRUPT');
      }
      const nameLen = u16(localHead, 26);
      const extraLen = u16(localHead, 28);
      const dataStart = entry.localOffset + 30 + nameLen + extraLen;
      if (dataStart + entry.compressedSize > fileSize) {
        throw new ZipError('entry data outside file bounds: ' + entry.name, 'ZIP_CORRUPT');
      }
      const raw = Buffer.alloc(entry.compressedSize);
      await fh.read(raw, 0, entry.compressedSize, dataStart);
      checkAbort(signal);
      let data;
      if (entry.method === 0) {
        data = raw;
      } else {
        data = inflateRawSync(raw, {
          maxOutputLength: entry.uncompressedSize + 1,
          finishFlush: zlibConstants.Z_FINISH,
        });
      }
      if (data.length !== entry.uncompressedSize) {
        throw new ZipError('size mismatch for ' + entry.name, 'ZIP_CORRUPT');
      }
      if (crc32(data) !== entry.crc32) {
        throw new ZipError('CRC 校验失败, 文件可能已损坏: ' + entry.name, 'ZIP_CORRUPT');
      }
      const target = resolve(destDir, rel);
      const root = resolve(destDir) + sep;
      if (!target.startsWith(root)) throw new ZipError('entry escapes destination: ' + entry.name, 'ZIP_UNSAFE');
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data);
      totalBytes += data.length;
      files.push({ name: rel, path: target, bytes: data.length });
    }
    return { files, totalBytes };
  } finally {
    await fh.close();
  }
}

/**
 * Read one entry as text without extracting the whole archive.
 * @param {string} zipPath
 * @param {string} entryName normalized archive name (forward slashes)
 * @param {{signal?: AbortSignal, maxBytes?: number}} [opts]
 * @returns {Promise<{text: string, bytes: number, truncated: boolean} | undefined>}
 */
export async function readZipEntryText(zipPath, entryName, opts = {}) {
  const signal = opts.signal;
  const maxBytes = opts.maxBytes ?? (64 << 20);
  const fh = await open(zipPath, 'r');
  try {
    const fileSize = (await fh.stat()).size;
    const eocd = await readEocd(fh, fileSize, signal);
    const entries = await readCentralDirectory(fh, eocd.cdOffset, eocd.cdSize, eocd.entryCount, signal);
    for (const entry of entries) {
      if (sanitizeEntryName(entry.name) !== entryName) continue;
      if (entry.method !== 0 && entry.method !== 8) throw new ZipError('unsupported compression method ' + entry.method, 'ZIP_UNSUPPORTED');
      if (entry.uncompressedSize > maxBytes) {
        // Bounded prefix: stored entries read directly; deflate streams decode
        // incrementally so a mid-stream cut still yields its partial output.
        const localHead = Buffer.alloc(30);
        await fh.read(localHead, 0, 30, entry.localOffset);
        const dataStart = entry.localOffset + 30 + u16(localHead, 26) + u16(localHead, 28);
        let data;
        if (entry.method === 0) {
          const want = Math.min(maxBytes, entry.compressedSize);
          const raw = Buffer.alloc(want);
          await fh.read(raw, 0, want, dataStart);
          data = raw;
        } else {
          data = await inflatePrefix(fh, dataStart, entry.compressedSize, maxBytes, signal);
        }
        return { text: data.toString('utf8'), bytes: entry.uncompressedSize, truncated: true };
      }
      const localHead = Buffer.alloc(30);
      await fh.read(localHead, 0, 30, entry.localOffset);
      const dataStart = entry.localOffset + 30 + u16(localHead, 26) + u16(localHead, 28);
      const raw = Buffer.alloc(entry.compressedSize);
      await fh.read(raw, 0, entry.compressedSize, dataStart);
      checkAbort(signal);
      const data = entry.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: entry.uncompressedSize + 1 });
      if (data.length !== entry.uncompressedSize) {
        throw new ZipError('size mismatch for ' + entry.name, 'ZIP_CORRUPT');
      }
      if (crc32(data) !== entry.crc32) {
        throw new ZipError('CRC 校验失败, 文件可能已损坏: ' + entry.name, 'ZIP_CORRUPT');
      }
      return { text: data.toString('utf8'), bytes: data.length, truncated: false };
    }
    return undefined;
  } finally {
    await fh.close();
  }
}