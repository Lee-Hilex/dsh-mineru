/**
 * Printed page labels: the declared physical-page -> printed-page systems.
 *
 * `document.md` is anchored in the **physical page order** of the file (`pN`),
 * which is not the number printed on the page: front matter is often numbered
 * with Roman numerals while the body restarts at 1, and a journal offprint keeps
 * the page numbers of the issue it was cut from. A caller declares those systems
 * with `segments` (1-based physical page ranges, ascending and non-overlapping):
 *
 * ```json
 * { "segments": [
 *   { "from": 1,   "to": 6,   "label": "i"  },
 *   { "from": 7,   "to": 106, "start": 1    },
 *   { "from": 107, "to": 132, "start": 105  }
 * ] }
 * ```
 *
 * `label` is the printed label of the segment's first page and is carried on in
 * its own style (Roman `i` -> i, ii, iii…; Arabic `1` -> 1, 2, 3…); `start` is
 * an Arabic first number. Only the case of a Roman label survives — zero padding
 * does not (`start: 1` never renders `001`).
 *
 * Two rules keep this module honest about what it knows:
 *
 * - the declaration is expanded into one label per declared page, so a segment
 *   reaching past the pages this run actually parsed is recorded, not applied;
 * - the labels are only ever compared with the `page_number` blocks the cloud
 *   read. Printed numbers repeat, go missing, or leave whole volumes in Roman
 *   numerals, so they can never be the primary key: the physical order stays it.
 *
 * Everything here is pure — ranges in, a page -> label map out — so it can be
 * unit-tested without a host, a network call or a document.
 * @module dsh-mineru/page-labels
 */

/** The seven Roman numeral letters, largest first. */
const ROMAN_VALUES = Object.freeze({ i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 });

/** Greedy Roman numeral table, subtractive forms included. */
const ROMAN_FORMS = Object.freeze([
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
  [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
  [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
]);

/**
 * Cap on the expanded declaration. A typo such as `to: 1000000` must not turn
 * into a million-entry `page-map.json` — no real page system is this long.
 */
export const MAX_SEGMENT_PAGES = 10000;

/**
 * Parse a simple Roman numeral such as `iv` / `IX`.
 *
 * Printed front matter often numbers its pages this way, so both the declared
 * labels and the self-check have to read them. Only the seven classic letters
 * are accepted (either case) and the subtractive rule is applied left to right;
 * shapes the Romans never wrote (`iix`) are accepted rather than rejected,
 * because this value only ever feeds a best-effort comparison with the physical
 * page order.
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
 * Render a positive integer as a standard Roman numeral.
 *
 * @param {number} value 1-based positive integer
 * @param {{upper?: boolean}} [options] `upper` matches an uppercase declaration
 * @returns {string}
 */
export function formatRomanNumeral(value, options = {}) {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError('formatRomanNumeral 需要一个 >= 1 的整数');
  }
  let rest = value;
  let out = '';
  for (const [amount, letters] of ROMAN_FORMS) {
    while (rest >= amount) {
      out += letters;
      rest -= amount;
    }
  }
  return options.upper === true ? out.toUpperCase() : out;
}

/**
 * Read one printed page label: Arabic digits or a Roman numeral.
 *
 * @param {unknown} text
 * @returns {number|null} the label's value, or null when it is neither
 */
export function parsePageLabel(text) {
  const style = labelStyle(text);
  return style === null ? null : style.value;
}

/**
 * Which system a declared label starts, and at which value.
 * @param {unknown} text
 * @returns {{style: 'roman'|'arabic', value: number, upper: boolean}|null}
 */
function labelStyle(text) {
  if (typeof text !== 'string') return null;
  const token = text.trim();
  if (token === '') return null;
  if (/^\d+$/.test(token)) {
    const value = Number(token);
    return value > 0 ? { style: 'arabic', value, upper: false } : null;
  }
  const value = parseRomanNumeral(token);
  if (value === null) return null;
  return { style: 'roman', value, upper: token === token.toUpperCase() };
}

/**
 * Validate a `segments` declaration without expanding it.
 *
 * Ordering and overlaps are errors (the mapping would be ambiguous); a range
 * that reaches past the pages this run parsed is not — see `checkLabelCoverage`.
 *
 * @param {unknown} input
 * @returns {{ok: true, segments: object[], pages: number, error: null}
 *   | {ok: false, segments: null, pages: 0, error: string}}
 */
export function validateSegments(input) {
  const fail = (error) => ({ ok: false, segments: null, pages: 0, error });
  if (!Array.isArray(input) || input.length === 0) {
    return fail('必须是非空数组，每个区间形如 { from, to, label } 或 { from, to, start }');
  }
  const segments = [];
  let previous = null;
  let pages = 0;
  for (let index = 0; index < input.length; index += 1) {
    const at = 'segments[' + index + ']';
    const item = input[index];
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      return fail(at + ' 必须是对象');
    }
    const { from, to } = item;
    if (!Number.isInteger(from) || from < 1) return fail(at + '.from 必须是 >= 1 的整数');
    if (!Number.isInteger(to) || to < 1) return fail(at + '.to 必须是 >= 1 的整数');
    if (from > to) return fail(at + ' 的 from (' + from + ') 大于 to (' + to + ')');

    const hasLabel = item.label !== undefined && item.label !== null;
    const hasStart = item.start !== undefined && item.start !== null;
    if (hasLabel && hasStart) return fail(at + ' 不能同时给 label 与 start');
    if (!hasLabel && !hasStart) return fail(at + ' 必须给 label 或 start 之一');
    if (hasLabel && labelStyle(item.label) === null) {
      return fail(at + '.label「' + String(item.label) + '」既不是阿拉伯数字也不是罗马数字');
    }
    if (!hasLabel && (!Number.isInteger(item.start) || item.start < 1)) {
      return fail(at + '.start 必须是 >= 1 的整数');
    }

    if (previous !== null) {
      if (from <= previous.from) {
        return fail(at + ' 的起始页 ' + from + ' 没有在上一个区间（第 ' + previous.from + '-' + previous.to
          + ' 页）之后：segments 必须按物理页升序排列');
      }
      if (from <= previous.to) {
        return fail('区间 ' + at + '（第 ' + from + '-' + to + ' 页）与上一个区间（第 '
          + previous.from + '-' + previous.to + ' 页）重叠');
      }
    }
    pages += to - from + 1;
    if (pages > MAX_SEGMENT_PAGES) {
      return fail('展开后超过 ' + MAX_SEGMENT_PAGES + ' 页，请检查区间是否写错');
    }
    segments.push(hasLabel
      ? { from, to, label: String(item.label).trim() }
      : { from, to, start: item.start });
    previous = { from, to };
  }
  return { ok: true, segments, pages, error: null };
}

/**
 * Expand a declaration into one printed label per declared page.
 *
 * @param {unknown} input the `segments` declaration
 * @returns {{
 *   segments: object[],
 *   pages: Array<{page: number, label: string, segment: number}>,
 *   byPage: Map<number, string>,
 * }}
 * @throws {TypeError} when the declaration fails `validateSegments`
 */
export function buildPageLabels(input) {
  const checked = validateSegments(input);
  if (!checked.ok) throw new TypeError('segments 声明不合法：' + checked.error);
  const pages = [];
  const byPage = new Map();
  checked.segments.forEach((segment, index) => {
    const style = segment.label !== undefined
      ? labelStyle(segment.label)
      : { style: 'arabic', value: segment.start, upper: false };
    const length = segment.to - segment.from + 1;
    for (let offset = 0; offset < length; offset += 1) {
      const page = segment.from + offset;
      const value = style.value + offset;
      const label = style.style === 'roman'
        ? formatRomanNumeral(value, { upper: style.upper })
        : String(value);
      pages.push({ page, label, segment: index + 1 });
      byPage.set(page, label);
    }
  });
  return { segments: checked.segments, pages, byPage };
}

/**
 * Compare the declaration against the pages this run actually parsed.
 *
 * Uncovered and out-of-range pages are findings, never failures: a declaration
 * describes a whole volume, while one run may parse a handful of its pages. That
 * is also why the out-of-range warning is gated on `wholeDocument` — with a
 * `pageRanges` subset in hand, every declared page outside the subset would
 * otherwise be reported, and the pages that really lack a label are the ones
 * present in the result.
 *
 * @param {{byPage: Map<number, string>, pages: Array<{page: number}>}} built
 * @param {number[]|null} [observedPages] physical pages present in this run
 * @param {{wholeDocument?: boolean}} [options] `wholeDocument: true` means the
 *   observed pages are the entire file, so a declared page outside them does not
 *   exist in this document
 * @returns {{uncoveredPages: number[], outOfRangePages: number[], warnings: string[]}}
 */
export function checkLabelCoverage(built, observedPages, options = {}) {
  const observed = Array.isArray(observedPages)
    ? [...new Set(observedPages.filter((page) => Number.isInteger(page) && page >= 1))]
      .sort((a, b) => a - b)
    : [];
  if (observed.length === 0) return { uncoveredPages: [], outOfRangePages: [], warnings: [] };

  const first = observed[0];
  const last = observed[observed.length - 1];
  const uncoveredPages = observed.filter((page) => !built.byPage.has(page));
  const outOfRangePages = built.pages
    .map((entry) => entry.page)
    .filter((page) => page < first || page > last);

  const warnings = [];
  if (uncoveredPages.length > 0) {
    warnings.push('本次解析的第 ' + formatPageList(uncoveredPages)
      + ' 页没有印刷页码映射（不在任何 segments 区间内）');
  }
  if (outOfRangePages.length > 0 && options.wholeDocument === true) {
    warnings.push('segments 声明覆盖到第 ' + formatPageList(outOfRangePages)
      + ' 页，超出本次解析的页范围（第 ' + first + '-' + last + ' 页）：这份文档里没有这些页');
  }
  return { uncoveredPages, outOfRangePages, warnings };
}

/**
 * Normalize a page -> label mapping from any shape the callers use.
 *
 * @param {Map<number, string>|Record<string, string>|Array<{page: number, label: string}>|null|undefined} value
 * @returns {Map<number, string>|null}
 */
export function toPageLabelMap(value) {
  if (value instanceof Map) return value;
  if (Array.isArray(value)) {
    const map = new Map();
    for (const entry of value) {
      if (entry && Number.isInteger(entry.page) && typeof entry.label === 'string') {
        map.set(entry.page, entry.label);
      }
    }
    return map.size > 0 ? map : null;
  }
  if (value !== null && typeof value === 'object') {
    const map = new Map();
    for (const [key, label] of Object.entries(value)) {
      const page = Number(key);
      if (Number.isInteger(page) && page >= 1 && typeof label === 'string') map.set(page, label);
    }
    return map.size > 0 ? map : null;
  }
  return null;
}

/**
 * Cross-check the labels the cloud read against the declared mapping.
 *
 * Both sides are compared by value, so Roman front matter matches Arabic
 * detection (`ii` on physical page 2 is consistent with a detected `2`).
 * Declared pages the cloud did not number are skipped — a missing printed
 * number is not a contradiction.
 *
 * @param {Map<number, string>} declaredByPage
 * @param {Map<number, number>} detectedByPage printed value per physical page
 * @returns {{compared: number, mismatches: Array<{page: number, declared: string, declaredValue: number, detected: number}>}}
 */
export function compareDetectedPageNumbers(declaredByPage, detectedByPage) {
  const mismatches = [];
  if (!(declaredByPage instanceof Map) || !(detectedByPage instanceof Map)) {
    return { compared: 0, mismatches };
  }
  let compared = 0;
  for (const [page, detected] of detectedByPage) {
    const declared = declaredByPage.get(page);
    if (declared === undefined) continue;
    const declaredValue = parsePageLabel(declared);
    if (declaredValue === null) continue;
    compared += 1;
    if (declaredValue !== detected) {
      mismatches.push({ page, declared, declaredValue, detected });
    }
  }
  mismatches.sort((a, b) => a.page - b.page);
  return { compared, mismatches };
}

/**
 * One warning line naming the pages whose declaration disagrees with the cloud.
 *
 * @param {Array<{page: number, declared: string, detected: number}>|null|undefined} mismatches
 * @returns {string|null} null when there is nothing to report
 */
export function formatLabelMismatchWarning(mismatches) {
  if (!Array.isArray(mismatches) || mismatches.length === 0) return null;
  const limit = 5;
  const parts = mismatches.slice(0, limit)
    .map((entry) => '第 ' + entry.page + ' 页声明为 ' + entry.declared + '，云端识别为 ' + entry.detected);
  const tail = mismatches.length > limit
    ? '（共 ' + mismatches.length + ' 页不一致，此处只列前 ' + limit + ' 页）'
    : '（共 ' + mismatches.length + ' 页不一致）';
  return 'segments 声明与云端识别到的印刷页码不一致：' + parts.join('；') + tail + '，请核对声明';
}

/**
 * Compact page list for a user-facing message: consecutive pages collapse into
 * `1-3`, and a long list stops after `limit` groups.
 * @param {number[]} pages ascending, unique
 * @param {number} [limit]
 * @returns {string} e.g. `1-3、7、9` or `1-3、7 等 40 页`
 */
function formatPageList(pages, limit = 12) {
  const groups = [];
  for (const page of pages) {
    const last = groups[groups.length - 1];
    if (last && page === last[1] + 1) last[1] = page;
    else groups.push([page, page]);
  }
  const shown = groups.slice(0, limit)
    .map(([from, to]) => (from === to ? String(from) : from + '-' + to))
    .join('、');
  return groups.length > limit ? shown + ' 等 ' + pages.length + ' 页' : shown;
}
