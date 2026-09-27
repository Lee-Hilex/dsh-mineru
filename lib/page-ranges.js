/**
 * Page-range parsing and page-list splitting (pure functions, no I/O).
 *
 * The precision API takes `page_ranges` as a comma-separated string and rejects
 * any single request asking for more than 200 pages, so a long document is split
 * by *request shaping* — same upload, a different `page_ranges` per chunk — and
 * never by rewriting the file locally.
 *
 * Two probed facts decide the rules below:
 *  - when `page_ranges` is present, the returned `content_list.json` renumbers
 *    `page_idx` from 0 for the requested subset (asking for pages 3-4 returns
 *    `page_idx` 0 and 1), so a block's original page can only be recovered from
 *    the page list that was requested — every chunk has to keep its own list;
 *  - negative indexes (`"2--2"`) are resolved by the server against the document,
 *    so such a spec can only be split after the local page count is known.
 *
 * A spec is parsed once into a page list and every chunk is a slice of it.
 * Slices stay ascending and non-overlapping because the subset-to-original
 * mapping is positional: an out-of-order spec would be mapped on the unverified
 * assumption that the server returns blocks in the requested order.
 * @module dsh-mineru/page-ranges
 */

/** Raised when a `page_ranges` spec cannot be used for local planning. */
export class PageRangeError extends Error {
  /**
   * @param {string} message user-facing reason
   * @param {string} code stable machine code
   * @param {string} [hint] what to write instead
   */
  constructor(message, code, hint) {
    super(message);
    this.name = 'PageRangeError';
    this.code = code;
    if (hint !== undefined) this.hint = hint;
  }
}

const SINGLE = /^(\d+)$/;
const RANGE = /^(\d+)\s*-\s*(-?\d+)$/;
const NEGATIVE_ONLY = /^-\d+$/;

/** @param {unknown} value @returns {boolean} */
function isPositiveInt(value) {
  return Number.isInteger(value) && value > 0;
}

/**
 * Resolve one written page number against the document total.
 * @param {string} raw a positive number, or a negative one counted from the end
 * @param {number} [totalPages] required for negative numbers
 * @returns {number} 1-based page number
 */
function resolvePageNumber(raw, totalPages) {
  const value = Number.parseInt(raw, 10);
  if (!Number.isInteger(value)) {
    throw new PageRangeError('无法解析页码「' + raw + '」', 'unparsable-page');
  }
  if (value > 0) return value;
  if (value === 0) {
    throw new PageRangeError('页码从 1 开始，不支持 0', 'page-zero');
  }
  if (!isPositiveInt(totalPages)) {
    throw new PageRangeError(
      '倒数页码「' + raw + '」需要先知道文档总页数',
      'need-total-pages',
      '先本地读出页数（PDF 文件可以），或改用正数页码',
    );
  }
  const resolved = totalPages + value + 1;
  if (resolved < 1) {
    throw new PageRangeError('倒数页码「' + raw + '」超出文档范围（共 ' + totalPages + ' 页）', 'page-out-of-range');
  }
  return resolved;
}

/** Collapse an ascending page list into [start, end] runs. */
function mergeConsecutive(pages) {
  const ranges = [];
  for (const page of pages) {
    const last = ranges[ranges.length - 1];
    if (last && page === last[1] + 1) last[1] = page;
    else ranges.push([page, page]);
  }
  return ranges;
}

/** Render runs as a `page_ranges` string (`1-3,5`). */
function rangesToSpec(ranges) {
  return ranges.map(([start, end]) => (start === end ? String(start) : start + '-' + end)).join(',');
}

/**
 * Write an ascending page list as a canonical `page_ranges` string.
 *
 * The single place that turns a page list back into API syntax, so chunk specs
 * and user-supplied specs cannot drift apart.
 * @param {number[]} pages ascending, unique, 1-based
 * @returns {string} e.g. `1-200,202`
 */
export function canonicalPageSpec(pages) {
  if (!Array.isArray(pages) || pages.length === 0) throw new TypeError('pages must be a non-empty array');
  let previous = 0;
  for (const page of pages) {
    if (!Number.isInteger(page) || page < 1) throw new TypeError('pages must be positive integers');
    if (page <= previous) throw new TypeError('pages must be ascending and unique');
    previous = page;
  }
  return rangesToSpec(mergeConsecutive(pages));
}

/**
 * Parse a `page_ranges` spec into the page list it selects.
 *
 * @param {string} spec e.g. `"2,4-6"`, `"2--2"`
 * @param {{totalPages?: number}} [options] required when the spec uses negative indexes
 * @returns {{pages: number[], canonical: string, offset: number}} `offset` is the
 *   0-based index of the first requested page, i.e. the subset index of page one
 * @throws {PageRangeError} when the spec cannot be planned against locally
 */
export function parsePageRanges(spec, options = {}) {
  const totalPages = options.totalPages;
  if (typeof spec !== 'string') throw new TypeError('spec must be a string');
  if (totalPages !== undefined && !isPositiveInt(totalPages)) {
    throw new RangeError('totalPages must be a positive integer when provided');
  }
  const trimmed = spec.trim();
  if (trimmed === '') throw new PageRangeError('pageRanges 不能为空字符串', 'empty-spec');

  const pages = [];
  let previousMax = 0;
  for (const rawToken of trimmed.split(',')) {
    const token = rawToken.trim();
    if (token === '') {
      throw new PageRangeError('pageRanges 里有多余的逗号：「' + spec + '」', 'empty-token');
    }
    const single = SINGLE.exec(token);
    const range = RANGE.exec(token);
    let start;
    let end;
    if (single) {
      start = resolvePageNumber(single[1], totalPages);
      end = start;
    } else if (range) {
      start = resolvePageNumber(range[1], totalPages);
      end = resolvePageNumber(range[2], totalPages);
      if (start > end) {
        throw new PageRangeError('页码范围「' + token + '」起止倒置（' + start + ' > ' + end + '）', 'reversed-range', '按升序书写，例如 4-6');
      }
    } else if (NEGATIVE_ONLY.test(token)) {
      throw new PageRangeError(
        '不支持单独使用倒数页码「' + token + '」',
        'negative-single',
        '改用范围写法，例如 "2--2" 表示第 2 页到倒数第二页',
      );
    } else {
      throw new PageRangeError('无法识别的页码范围片段「' + token + '」', 'unparsable-token', '支持写法：2、4-6、2--2，逗号分隔');
    }
    if (isPositiveInt(totalPages) && end > totalPages) {
      throw new PageRangeError('页码范围「' + token + '」超出文档范围（共 ' + totalPages + ' 页）', 'page-out-of-range');
    }
    if (start <= previousMax) {
      throw new PageRangeError(
        '页码范围「' + token + '」与前一段重叠或未按升序排列',
        'unsorted-overlap',
        '按升序、不重叠地书写，例如 "2,4-6"',
      );
    }
    for (let page = start; page <= end; page += 1) pages.push(page);
    previousMax = end;
  }

  return {
    pages,
    canonical: canonicalPageSpec(pages),
    offset: pages[0] - 1,
  };
}

/**
 * Cut a page list into per-request chunks of at most `maxPagesPerRequest` pages.
 *
 * @param {number[]} pages ascending 1-based page list (the whole request)
 * @param {number} maxPagesPerRequest per-request page cap (200 on the precision API)
 * @returns {Array<{index: number, pages: number[], spec: string, start: number, end: number, offset: number}>}
 *   one entry per request; a single entry means the request needs no splitting
 */
export function planPageChunks(pages, maxPagesPerRequest) {
  if (!Array.isArray(pages) || pages.length === 0) throw new TypeError('pages must be a non-empty array');
  if (!isPositiveInt(maxPagesPerRequest)) throw new RangeError('maxPagesPerRequest must be a positive integer');
  const chunks = [];
  for (let cursor = 0; cursor < pages.length; cursor += maxPagesPerRequest) {
    const slice = pages.slice(cursor, cursor + maxPagesPerRequest);
    chunks.push({
      index: chunks.length + 1,
      pages: slice,
      spec: canonicalPageSpec(slice),
      start: slice[0],
      end: slice[slice.length - 1],
      offset: slice[0] - 1,
    });
  }
  return chunks;
}
