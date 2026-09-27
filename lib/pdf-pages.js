/**
 * Best-effort local page count for PDFs (pure function, no I/O).
 *
 * Why it exists: splitting a long document means asking for `page_ranges`
 * chunks, and both the chunk plan and a negative spec like `"2--2"` need the
 * document total before any request goes out. The host half is plain Node with
 * no PDF library, so this reads the page tree the way a viewer's preflight does:
 *
 *  1. the `/Count` of a `/Type /Pages` node — the largest one found is the
 *     document total, because a root node's count covers its subtrees (bounded
 *     lookahead after each node, see COUNT_WINDOW);
 *  2. how many `/Type /Page` leaf objects appear;
 *  3. the same two scans over every decodable stream, because PDF 1.5+ may keep
 *     page objects inside `/Type /ObjStm` object streams.
 *
 * Boundaries: an encrypted, damaged or otherwise unusual file can leave the
 * count undetermined; the function then reports `pages: null` and the caller
 * keeps its previous single-request behaviour instead of guessing a number.
 * @module dsh-mineru/pdf-pages
 */
import { inflateRawSync, inflateSync } from 'node:zlib';

/**
 * Largest PDF read into one latin1 string. V8 caps string length well above
 * this, but a whole-file scan of a 200 MB upload is already the expensive path,
 * and an undetermined count is a supported outcome.
 */
const MAX_SCAN_BYTES = 256 * 1024 * 1024;
/** Bytes searched after a `/Type /Pages` node for its own `/Count`. */
const COUNT_WINDOW = 1024 * 1024;
/** Upper bound on one decoded stream (an image stream is not a page tree). */
const MAX_STREAM_BYTES = 16 * 1024 * 1024;
/** Upper bound on all decoded stream text per document. */
const MAX_DECODED_BYTES = 64 * 1024 * 1024;

const PAGES_NODE_SOURCE = String.raw`\/Type\s*\/Pages\b`;
const PAGE_LEAF_SOURCE = String.raw`\/Type\s*\/Page(?![A-Za-z])`;
const COUNT_VALUE = /^\s+(\d+)/;

/** @param {string} text @param {string} source @returns {number} */
function countMatches(text, source) {
  const re = new RegExp(source, 'g');
  let count = 0;
  while (re.exec(text) !== null) count += 1;
  return count;
}

/**
 * Collect the `/Count` of every page-tree node found in one text blob.
 *
 * The lookahead is `indexOf`-based rather than a windowed regex: a big document
 * has many page-tree nodes, and a per-node regex window would rescan megabytes
 * per node.
 * @param {string} text @param {number[]} counts output list
 */
function collectCounts(text, counts) {
  const re = new RegExp(PAGES_NODE_SOURCE, 'g');
  let match;
  while ((match = re.exec(text)) !== null) {
    const from = match.index + match[0].length;
    const at = text.indexOf('/Count', from);
    if (at === -1 || at - from > COUNT_WINDOW) continue;
    const value = COUNT_VALUE.exec(text.slice(at + 6, at + 30));
    if (value) counts.push(Number.parseInt(value[1], 10));
  }
}

/**
 * Texts of every deflate-decodable stream in the file.
 *
 * Page objects of PDF 1.5+ documents live inside object streams, so the raw byte
 * scan sees only the container. Only streams that decompress without error
 * contribute, and only up to the byte caps above.
 * @param {Buffer} buffer @returns {string[]}
 */
function decodedStreamTexts(buffer) {
  const texts = [];
  const streamMarker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  let total = 0;
  let index = buffer.indexOf(streamMarker);
  while (index !== -1 && total < MAX_DECODED_BYTES) {
    // "endstream" contains "stream" too; only real stream starts count.
    if (index >= 3 && buffer.toString('latin1', index - 3, index) === 'end') {
      index = buffer.indexOf(streamMarker, index + streamMarker.length);
      continue;
    }
    let dataStart = index + streamMarker.length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;
    const dataEnd = buffer.indexOf(endMarker, dataStart);
    if (dataEnd === -1) break;
    const raw = buffer.subarray(dataStart, dataEnd);
    if (raw.length > 0 && raw.length <= MAX_STREAM_BYTES) {
      for (const inflate of [inflateSync, inflateRawSync]) {
        try {
          const out = inflate(raw, { maxOutputLength: MAX_STREAM_BYTES });
          texts.push(out.toString('latin1'));
          total += out.length;
          break;
        } catch {
          // Not a zlib/deflate stream (image data, ASCII filters) — try the next
          // inflate flavour and otherwise ignore the stream.
        }
      }
    }
    index = buffer.indexOf(streamMarker, dataEnd + endMarker.length);
  }
  return texts;
}

/**
 * @typedef {object} PdfPageCount
 * @property {number|null} pages total pages, or null when it cannot be determined
 * @property {'count'|'count+objstm'|'page-objects'|'none'} method how it was obtained;
 *   `count+objstm` means the number came out of a decoded object stream
 */

/**
 * @param {Buffer|Uint8Array} input PDF bytes
 * @returns {PdfPageCount}
 */
export function countPdfPages(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length === 0) return { pages: null, method: 'none' };
  const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
  if (!head.includes('%PDF-')) return { pages: null, method: 'none' };
  if (buffer.length > MAX_SCAN_BYTES) return { pages: null, method: 'none' };

  const counts = [];
  const rawText = buffer.toString('latin1');
  collectCounts(rawText, counts);
  let pageObjects = countMatches(rawText, PAGE_LEAF_SOURCE);

  let countFromStream = false;
  const decoded = decodedStreamTexts(buffer);
  for (const text of decoded) {
    const before = counts.length;
    collectCounts(text, counts);
    if (counts.length > before) countFromStream = true;
    pageObjects += countMatches(text, PAGE_LEAF_SOURCE);
  }

  let maxCount = 0;
  for (const value of counts) if (value > maxCount) maxCount = value;
  if (maxCount > 0) {
    return { pages: maxCount, method: countFromStream ? 'count+objstm' : 'count' };
  }
  if (pageObjects > 0) return { pages: pageObjects, method: 'page-objects' };
  return { pages: null, method: 'none' };
}
