/**
 * Page-anchored Markdown for precision-API results (pure functions, no host
 * dependencies).
 *
 * `document.md` is an opt-in companion to the untouched `full.md`: the same
 * blocks in `content_list.json` order, each preceded by one HTML comment
 * anchor so a reader (or an agent) can cite the page a sentence came from:
 *
 * ```
 * <!-- p12 b3 -->
 * 君子务本，本立而道生。
 * ```
 *
 * Two rules drive everything here:
 *
 * - **`page_idx` is a request-relative index.** When `page_ranges` is set the
 *   cloud renumbers the requested subset from 0, so `requestedPages[page_idx]`
 *   is the only correct way back to the original page — an offset alone breaks
 *   on discrete ranges such as `"2,4-6"`;
 * - **`bK` counts blocks inside their page, in content-list order.** Auxiliary
 *   blocks (`header` / `footer` / `page_number` / `aside_text`) are left out of
 *   the body stream but still occupy their number, so `bK` always points at the
 *   K-th block of that page in `content_list.json` (a gap is expected, not a
 *   bug).
 *
 * A block whose page cannot be resolved keeps its anchor as `<!-- p? bK -->`
 * instead of being dropped.
 *
 * `pN` is the **physical page order of this file** (1-based, cover and front
 * matter included) — not the page number printed on the page. When the result
 * carries readable `page_number` blocks the renderer compares the two on a
 * best-effort basis and reports a constant or non-constant difference (see
 * `pageNumbers` on the result); the anchors themselves never change.
 * @module dsh-mineru/anchors
 */
import { readFile } from 'node:fs/promises';

/** Block types rendered into the body stream. */
export const BODY_TYPES = Object.freeze([
  'text', 'title', 'paragraph_title', 'list', 'code', 'ref_text',
  'equation', 'table', 'chart', 'image',
]);

/** Page furniture: kept out of the body stream, but still counted. */
export const AUX_TYPES = Object.freeze(['header', 'footer', 'page_number', 'aside_text']);

/** Cloud marker for a block it could not read. */
export const UNREADABLE_MARKER = '[Unreadable]';

const AUX_SET = new Set(AUX_TYPES);

/** Key order used to pull a block's text out of V1 / V2 shapes. */
const CONTENT_KEYS = Object.freeze([
  'text',
  'content',
  'table_body',
  'html',
  'math_content',
  'paragraph_content',
  'item_content',
  'list_items',
]);

/**
 * Flatten a block field into plain text, falling back across the known keys.
 * @param {unknown} node
 * @returns {string}
 */
export function extractText(node) {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (Array.isArray(node)) {
    return node.map(extractText).filter((part) => part !== '').join('\n');
  }
  if (typeof node === 'object') {
    for (const key of CONTENT_KEYS) {
      if (key in node) {
        const value = extractText(node[key]);
        if (value !== '') return value;
      }
    }
  }
  return '';
}

/**
 * @param {unknown} type
 * @returns {'body' | 'aux' | 'other'}
 */
export function classifyBlockType(type) {
  if (typeof type !== 'string' || type === '') return 'other';
  if (AUX_SET.has(type)) return 'aux';
  return BODY_TYPES.includes(type) ? 'body' : 'other';
}

/**
 * True when a block carries nothing but the cloud's unreadable marker.
 * @param {string} text
 * @returns {boolean}
 */
export function isUnreadableText(text) {
  if (typeof text !== 'string' || text === '') return false;
  return text.split(UNREADABLE_MARKER).join('').trim() === '';
}

/** Roman numeral values, for front matter printed with Roman numerals. */
const ROMAN_VALUES = Object.freeze({ i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 });

/**
 * Parse a simple Roman numeral such as `iv` / `IX`.
 *
 * Printed front matter often numbers its pages this way, so the self-check has
 * to read them too. Only the seven classic letters are accepted (either case)
 * and the subtractive rule is applied left to right; shapes the Romans never
 * wrote (`iix`) are accepted rather than rejected, because this value only
 * ever feeds a best-effort comparison with the physical page order.
 *
 * @param {unknown} text
 * @returns {number|null} the value, or null when `text` is not a Roman numeral
 */
export function parseRomanNumeral(text) {
  if (typeof text !== 'string') return null;
  const token = text.trim().toLowerCase();
  if (token === '' || !/^[ivxlcdm]+$/.test(token)) return null;
  let total = 0;
  for (let index = 0; index < token.length; index += 1) {
    const value = ROMAN_VALUES[token[index]];
    const next = index + 1 < token.length ? ROMAN_VALUES[token[index + 1]] : 0;
    total += value < next ? -value : value;
  }
  return total > 0 ? total : null;
}

/**
 * Parse the text of a `page_number` block into a printed page number.
 *
 * Accepts Arabic digits and Roman numerals. Everything else — empty text, the
 * cloud's `[Unreadable]` marker, running heads like `第 3 页`, `1 / 200` — is
 * not a printed page number we can compare, so it yields null and the page is
 * simply left out of the self-check.
 *
 * @param {unknown} text
 * @returns {number|null}
 */
export function parsePrintedPageNumber(text) {
  if (typeof text !== 'string') return null;
  const token = text.trim();
  if (token === '' || isUnreadableText(token)) return null;
  if (/^\d+$/.test(token)) {
    const value = Number(token);
    return value > 0 ? value : null;
  }
  return parseRomanNumeral(token);
}

/** Signed offset for user-facing messages: `+3` / `-2` / `0`. */
function formatPageOffset(offset) {
  return offset > 0 ? '+' + offset : String(offset);
}

/** @param {unknown} value @returns {string} */
function scalar(value) {
  if (typeof value === 'string') return value;
  return extractText(value);
}

/** Markdown heading prefix from the cloud's heading level, when it gives one. */
function headingPrefix(block) {
  const level = Number.isInteger(block.text_level) ? block.text_level : null;
  if (level !== null && level >= 1 && level <= 6) return '#'.repeat(level) + ' ';
  return '';
}

/** The cloud's table caption arrives as an array of strings (or a string). */
function captionText(block) {
  const raw = Array.isArray(block.table_caption) ? block.table_caption : [block.table_caption];
  return raw.map(scalar).filter((part) => part !== '').join(' ');
}

/**
 * Render one block's body (the anchor line is added by the caller).
 * @param {Record<string, unknown>} block
 * @param {string} text flattened block text
 * @param {(message: string) => void} warn
 * @returns {string}
 */
function renderBlock(block, text, warn) {
  const type = String(block.type);
  const unreadable = isUnreadableText(text);

  if (type === 'table') {
    const parts = [];
    const caption = captionText(block);
    if (caption !== '') parts.push('**' + caption + '**');
    const html = scalar(block.table_body) || scalar(block.html);
    if (html !== '') {
      parts.push(html);
    } else if (typeof block.img_path === 'string' && block.img_path !== '') {
      // Always the reference the cloud itself gave; never build *_body_* names.
      parts.push('![table](' + block.img_path + ')');
    } else {
      // Keep the anchor: an unreadable table is a finding, not a reason to drop it.
      parts.push(UNREADABLE_MARKER);
      warn('表格块既没有 table_body 也没有 img_path，已保留锚点与占位');
    }
    return parts.join('\n\n');
  }

  if (type === 'image' || type === 'chart') {
    if (typeof block.img_path === 'string' && block.img_path !== '') {
      return '![' + type + '](' + block.img_path + ')';
    }
    warn(type + ' 块没有 img_path，已保留锚点与占位');
    return UNREADABLE_MARKER;
  }

  if (type === 'equation') {
    const language = typeof block.text_format === 'string' && block.text_format !== ''
      ? block.text_format
      : 'latex';
    if (unreadable || text === '') return UNREADABLE_MARKER;
    return '```' + language + '\n' + text + '\n```';
  }

  if (unreadable) return UNREADABLE_MARKER;
  return headingPrefix(block) + text;
}

/**
 * Parse a MinerU `page_ranges` string into the ordered list of pages the
 * request actually asked for.
 *
 * Needed because `page_idx` in the returned `content_list.json` is an index
 * into *this* request's subset. Supports the official syntax: `2`, `4-6`,
 * and negative indexes such as `2--2` (which resolve against `totalPages`).
 *
 * @param {string} spec e.g. `"2,4-6"`
 * @param {{totalPages?: number|null}} [options]
 * @returns {{
 *   pages: number[],
 *   canonical: string,
 *   unresolvedNegative: boolean,
 *   offset: number,
 *   warnings: string[],
 * }}
 */
export function parseRequestedPages(spec, options = {}) {
  if (typeof spec !== 'string' || spec.trim() === '') {
    throw new TypeError('spec must be a non-empty page-ranges string');
  }
  const totalPages = Number.isInteger(options.totalPages) && options.totalPages > 0
    ? options.totalPages
    : null;
  const warnings = [];
  const seen = new Set();
  let unresolvedNegative = false;
  let firstPositivePage = null;
  const tokens = spec.split(',').map((token) => token.trim()).filter((token) => token !== '');

  for (const token of tokens) {
    const negative = /^-\d+$/.test(token);
    const range = /^(\d+)-(-?\d+)$/.exec(token);
    const single = /^(\d+)$/.exec(token);
    let start = null;
    let end = null;
    if (range) {
      start = Number(range[1]);
      end = Number(range[2]);
    } else if (single) {
      start = Number(single[1]);
      end = start;
    } else if (negative) {
      start = Number(token);
      end = start;
    } else {
      warnings.push('无法识别的页码范围片段「' + token + '」，已忽略');
      continue;
    }
    if (start > 0 && (firstPositivePage === null || start < firstPositivePage)) {
      firstPositivePage = start;
    }
    const resolve = (value) => {
      if (value > 0) return value;
      if (totalPages === null) { unresolvedNegative = true; return null; }
      const page = totalPages + value + 1;
      return page >= 1 ? page : null;
    };
    if (start <= 0 && end <= 0) {
      const a = resolve(start);
      const b = resolve(end);
      if (a === null || b === null) { unresolvedNegative = true; continue; }
      for (let page = Math.min(a, b); page <= Math.max(a, b); page += 1) seen.add(page);
      continue;
    }
    if (end < 0) {
      const b = resolve(end);
      if (b === null) { unresolvedNegative = true; continue; }
      for (let page = start; page <= b; page += 1) seen.add(page);
      continue;
    }
    for (let page = start; page <= end; page += 1) seen.add(page);
  }

  const pages = [...seen].sort((a, b) => a - b);
  if (pages.length === 0) {
    warnings.push('页码清单「' + spec + '」没有解析出可用的正数页码，锚点将无法映射回原文页码');
    unresolvedNegative = true;
  }
  if (unresolvedNegative) {
    warnings.push('页码范围「' + spec + '」含倒数页码，但本次结果无法确定文档总页数：锚点按「首个正数页码」推算，倒数码之后的页可能偏移，请核对');
  }
  // canonical is only meaningful for a resolved, ascending page list.
  const ranges = [];
  for (const page of pages) {
    const last = ranges[ranges.length - 1];
    if (last && page === last[1] + 1) last[1] = page;
    else ranges.push([page, page]);
  }
  return {
    pages,
    canonical: ranges.map(([a, b]) => (a === b ? String(a) : a + '-' + b)).join(','),
    unresolvedNegative,
    firstPositivePage,
    offset: firstPositivePage === null ? 0 : firstPositivePage - 1,
    warnings,
  };
}

/**
 * Build the page-anchored Markdown for one precision result.
 *
 * @param {Array<Record<string, unknown>>} contentList `content_list.json`
 * @param {{
 *   pageNumbers?: number[] | null,
 *   pageOffset?: number,
 *   pageRanges?: string | null,
 * }} [options]
 *   `pageNumbers` / `pageOffset` say how to turn a request-relative `page_idx`
 *   into an original 1-based page; `pageRanges` (the raw request string) is
 *   only used to derive them when neither is given.
 * @returns {{
 *   markdown: string,
 *   anchors: Array<{ page: number|null, index: number, type: string, kind: string, emitted: boolean }>,
 *   stats: Record<string, unknown>,
 *   pageNumbers: { detected: number, total: number, offsets: number[] },
 *   warnings: string[],
 * }}
 *   `pageNumbers` is the best-effort self-check of the printed page numbers
 *   found in the `page_number` blocks against the physical page order:
 *   `detected` counted pages, `total` rendered pages, `offsets` the distinct
 *   printed-minus-physical differences (sorted, ascending).
 */
export function synthesizeDocument(contentList, options = {}) {
  if (!Array.isArray(contentList)) throw new TypeError('contentList must be an array');

  const warnings = [];
  const warningSeen = new Set();
  const warn = (message) => {
    if (warningSeen.has(message)) return;
    warningSeen.add(message);
    warnings.push(message);
  };

  const hasPageNumbers = Array.isArray(options.pageNumbers) && options.pageNumbers.length > 0;
  let pageNumbers = hasPageNumbers ? options.pageNumbers : null;
  let pageOffset = Number.isInteger(options.pageOffset) && options.pageOffset >= 0
    ? options.pageOffset
    : 0;

  if (!pageNumbers && typeof options.pageRanges === 'string' && options.pageRanges.trim() !== '') {
    // totalPages is deliberately not guessed from the result: the content list
     // only covers the requested subset, so its highest page_idx says nothing
     // about the document length. Without a real total, negative indexes fall
     // back to the first positive page and the warning below says so.
    const parsed = parseRequestedPages(options.pageRanges);
    for (const message of parsed.warnings) warn(message);
    if (parsed.pages.length > 0 && !parsed.unresolvedNegative) {
      pageNumbers = parsed.pages;
    } else if (parsed.firstPositivePage !== null && options.pageOffset === undefined) {
      // Negative indexes with an unknown total: the subset still starts at a
      // known page, so an offset is the best available mapping (and the
      // warning above says so). An explicit caller-supplied offset wins.
      pageOffset = parsed.offset;
    }
  }
  if (pageNumbers && !pageNumbers.every((page) => Number.isInteger(page) && page >= 1)) {
    throw new TypeError('pageNumbers must be an array of 1-based integers');
  }

  const pageOf = (rawPageIdx) => {
    if (pageNumbers) return pageNumbers[rawPageIdx] ?? null;
    return rawPageIdx + pageOffset + 1;
  };

  const counters = new Map();
  const anchors = [];
  const chunks = [];
  const textByPage = new Map();
  // Physical page -> printed page number, first readable candidate wins.
  const printedByPage = new Map();
  let missingPageIdx = 0;
  let outOfRange = 0;
  let auxBlocks = 0;
  let unknownTypes = 0;
  let unreadableBlocks = 0;

  for (const block of contentList) {
    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
      warn('content_list 里出现了非对象记录，已跳过');
      continue;
    }
    const rawPage = block.page_idx;
    const hasPage = Number.isInteger(rawPage) && rawPage >= 0;
    if (!hasPage) missingPageIdx += 1;
    const page = hasPage ? pageOf(rawPage) : null;
    if (hasPage && page === null) outOfRange += 1;

    // The in-page counter advances for every block, including the auxiliary
    // ones we do not render, so bK keeps pointing at the same record in
    // content_list.json regardless of what this renderer chooses to show.
    const key = page === null ? '?' : String(page);
    const index = (counters.get(key) ?? 0) + 1;
    counters.set(key, index);
    const type = typeof block.type === 'string' && block.type !== '' ? block.type : '(missing type)';
    const kind = classifyBlockType(block.type);
    const text = extractText(block);
    if (isUnreadableText(text)) unreadableBlocks += 1;

    if (kind === 'aux') {
      auxBlocks += 1;
      // The printed page number lives in an auxiliary block, and the physical
      // page it sits on comes from the same mapping the anchors use — never a
      // second derivation, or the self-check would compare two different things.
      if (type === 'page_number' && page !== null && !printedByPage.has(page)) {
        const printed = parsePrintedPageNumber(text);
        if (printed !== null) printedByPage.set(page, printed);
      }
      anchors.push({ page, index, type, kind, emitted: false });
      continue;
    }
    if (kind === 'other') {
      unknownTypes += 1;
      warn('content_list 里出现了未收录的块类型「' + type + '」，已按正文渲染');
    }
    if (page !== null) {
      textByPage.set(page, (textByPage.get(page) ?? '') + text);
    }
    anchors.push({ page, index, type, kind, emitted: true });
    chunks.push('<!-- p' + (page === null ? '?' : page) + ' b' + index + ' -->\n' + renderBlock(block, text, warn));
  }

  if (missingPageIdx > 0) warn('有 ' + missingPageIdx + ' 个块缺少 page_idx，锚点降级为 p?');
  if (outOfRange > 0) warn('有 ' + outOfRange + ' 个块的 page_idx 超出请求页码清单，锚点降级为 p?');
  if (unreadableBlocks > 0) {
    warn('有 ' + unreadableBlocks + ' 个块被云端标为不可读（' + UNREADABLE_MARKER + '），已保留锚点与占位');
  }

  const pageList = [...new Set(anchors.map((anchor) => anchor.page).filter((page) => page !== null))]
    .sort((a, b) => a - b);
  const charCountByPage = pageList.map((page) => ({
    page,
    chars: [...(textByPage.get(page) ?? '')].length,
  }));

  const detectedOffsets = [...printedByPage.entries()]
    .map(([page, printed]) => printed - page)
    .sort((a, b) => a - b);
  const offsets = [...new Set(detectedOffsets)];
  const pageNumberCheck = { detected: detectedOffsets.length, total: pageList.length, offsets };

  if (offsets.length === 1 && offsets[0] !== 0) {
    warn('印刷页码与物理页序整体相差 ' + formatPageOffset(offsets[0])
      + '（前言用罗马数字，或用析出文献保留原刊页码，都会造成整体偏移）；'
      + '锚点仍用物理页序，可用页码映射声明两者的对应关系');
  } else if (offsets.length > 1) {
    warn('检测到多套偏移（' + offsets.map(formatPageOffset).join('、')
      + '），锚点仍用物理页序，请按页码映射逐页核对印刷页码');
  }

  return {
    markdown: chunks.length === 0 ? '' : chunks.join('\n\n') + '\n',
    anchors,
    stats: {
      blocks: anchors.length,
      pages: pageList.length,
      pageNumbers: pageList,
      bodyBlocks: anchors.filter((anchor) => anchor.emitted).length,
      auxBlocks,
      unknownTypes,
      unreadableBlocks,
      missingPageIdx,
      outOfRange,
      charCountByPage,
    },
    pageNumbers: pageNumberCheck,
    warnings,
  };
}

/**
 * Read a `content_list.json` from an extracted run directory.
 *
 * Accepts the array shape the API returns today and the `{ content_list: [...] }`
 * wrapper some MinerU exports use; a leading BOM is tolerated.
 *
 * @param {string} filePath
 * @returns {Promise<Array<Record<string, unknown>>>}
 */
export async function readContentListFile(filePath) {
  const raw = await readFile(filePath, 'utf8');
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error('content_list.json 不是合法 JSON: ' + (err?.message ?? String(err)));
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.content_list;
  if (!Array.isArray(list)) throw new Error('content_list.json 既不是数组也不含 content_list 数组');
  return list;
}
