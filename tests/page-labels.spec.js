/**
 * Printed page labels (`segments` -> `page-map.json` -> the `page_number`
 * self-check).
 *
 * The declared systems are the ones the issue describes: Roman front matter, an
 * Arabic body that restarts at 1, and an offprint that keeps the page numbers of
 * the journal it came from. Everything is synthetic and pure — no document, no
 * network, no host (every cloud call costs quota; see AGENTS.md).
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_SEGMENT_PAGES,
  buildPageLabels,
  checkLabelCoverage,
  compareDetectedPageNumbers,
  formatLabelMismatchWarning,
  formatRomanNumeral,
  parsePageLabel,
  parseRomanNumeral,
  toPageLabelMap,
  validateSegments,
} from '../lib/page-labels.js';

/** Front matter in Roman numerals, body 1-100, then an offprint starting at 105. */
const THREE_SEGMENTS = [
  { from: 1, to: 6, label: 'i' },
  { from: 7, to: 106, start: 1 },
  { from: 107, to: 132, start: 105 },
];

/** @param {Record<number, string>} entries @returns {Map<number, string>} */
function labelMap(entries) {
  return new Map(Object.entries(entries).map(([page, label]) => [Number(page), label]));
}

describe('Roman numerals as page labels', () => {
  it('parses the numerals front matter is printed with', () => {
    expect(parseRomanNumeral('iv')).toBe(4);
    expect(parseRomanNumeral('IX')).toBe(9);
    expect(parseRomanNumeral('xii')).toBe(12);
    expect(parseRomanNumeral('第 3 页')).toBeNull();
    expect(parseRomanNumeral('')).toBeNull();
  });

  it('renders standard numerals for every value a declaration can reach', () => {
    expect(formatRomanNumeral(1)).toBe('i');
    expect(formatRomanNumeral(4)).toBe('iv');
    expect(formatRomanNumeral(9)).toBe('ix');
    expect(formatRomanNumeral(40)).toBe('xl');
    expect(formatRomanNumeral(1984)).toBe('mcmlxxxiv');
    expect(formatRomanNumeral(3, { upper: true })).toBe('III');
    expect(() => formatRomanNumeral(0)).toThrow(TypeError);
    expect(() => formatRomanNumeral(1.5)).toThrow(TypeError);
  });

  it('reads a label the way it was written', () => {
    expect(parsePageLabel('iv')).toBe(4);
    expect(parsePageLabel(' 12 ')).toBe(12);
    expect(parsePageLabel('007')).toBe(7);
    expect(parsePageLabel('1 / 200')).toBeNull();
    expect(parsePageLabel('第 3 页')).toBeNull();
    expect(parsePageLabel(null)).toBeNull();
  });
});

describe('validateSegments', () => {
  it('accepts the three-segment declaration and normalizes it', () => {
    const checked = validateSegments(THREE_SEGMENTS);
    expect(checked.ok).toBe(true);
    expect(checked.error).toBeNull();
    expect(checked.pages).toBe(132);
    expect(checked.segments).toEqual(THREE_SEGMENTS);
  });

  it('rejects a declaration that is not a non-empty array', () => {
    expect(validateSegments(undefined).error).toContain('非空数组');
    expect(validateSegments([]).error).toContain('非空数组');
    expect(validateSegments('1-6').error).toContain('非空数组');
  });

  it('rejects a range that is not a pair of 1-based integers', () => {
    expect(validateSegments([{ from: 0, to: 6, label: 'i' }]).error).toContain('from 必须是 >= 1 的整数');
    expect(validateSegments([{ from: 1, to: 1.5, label: 'i' }]).error).toContain('to 必须是 >= 1 的整数');
    expect(validateSegments([{ from: '1', to: 6, label: 'i' }]).error).toContain('from 必须是 >= 1 的整数');
    expect(validateSegments([null]).error).toContain('必须是对象');
  });

  it('rejects from > to', () => {
    const checked = validateSegments([{ from: 7, to: 6, label: 'i' }]);
    expect(checked.ok).toBe(false);
    expect(checked.error).toContain('大于 to');
  });

  it('rejects a segment that gives both label and start, or neither', () => {
    expect(validateSegments([{ from: 1, to: 2, label: 'i', start: 1 }]).error)
      .toContain('不能同时给 label 与 start');
    expect(validateSegments([{ from: 1, to: 2 }]).error).toContain('必须给 label 或 start');
  });

  it('rejects a label that is neither Arabic nor Roman', () => {
    expect(validateSegments([{ from: 1, to: 2, label: '一' }]).error).toContain('既不是阿拉伯数字也不是罗马数字');
    expect(validateSegments([{ from: 1, to: 2, start: 0 }]).error).toContain('start 必须是 >= 1 的整数');
  });

  it('rejects overlapping segments', () => {
    const checked = validateSegments([
      { from: 1, to: 10, label: 'i' },
      { from: 10, to: 12, start: 1 },
    ]);
    expect(checked.ok).toBe(false);
    expect(checked.error).toContain('重叠');
  });

  it('rejects segments that are not in ascending physical-page order', () => {
    const checked = validateSegments([
      { from: 7, to: 10, start: 1 },
      { from: 3, to: 6, label: 'i' },
    ]);
    expect(checked.ok).toBe(false);
    expect(checked.error).toContain('升序');
  });

  it('rejects a declaration whose expansion is implausibly large', () => {
    const checked = validateSegments([{ from: 1, to: MAX_SEGMENT_PAGES + 1, start: 1 }]);
    expect(checked.ok).toBe(false);
    expect(checked.error).toContain(String(MAX_SEGMENT_PAGES));
  });
});

describe('buildPageLabels', () => {
  it('carries a Roman label on in its own style', () => {
    const built = buildPageLabels([{ from: 1, to: 6, label: 'i' }]);
    expect(built.pages.map((entry) => entry.label)).toEqual(['i', 'ii', 'iii', 'iv', 'v', 'vi']);
    expect(built.byPage.get(4)).toBe('iv');
  });

  it('keeps the case a Roman label was declared in', () => {
    const built = buildPageLabels([{ from: 3, to: 5, label: 'I' }]);
    expect(built.pages.map((entry) => entry.label)).toEqual(['I', 'II', 'III']);
  });

  it('carries an Arabic start on page by page', () => {
    const built = buildPageLabels([{ from: 7, to: 9, start: 105 }]);
    expect(built.pages).toEqual([
      { page: 7, label: '105', segment: 1 },
      { page: 8, label: '106', segment: 1 },
      { page: 9, label: '107', segment: 1 },
    ]);
  });

  it('does not pad an Arabic label to the width it was written with', () => {
    // Documented rule: only the case of a Roman label survives, never zero
    // padding — `007` declares the value 7, not a three-character format.
    const built = buildPageLabels([{ from: 1, to: 2, label: '007' }]);
    expect(built.pages.map((entry) => entry.label)).toEqual(['7', '8']);
  });

  it('maps the three-segment declaration page by page', () => {
    const built = buildPageLabels(THREE_SEGMENTS);
    expect(built.pages).toHaveLength(132);
    expect(built.byPage.get(1)).toBe('i');
    expect(built.byPage.get(6)).toBe('vi');
    expect(built.byPage.get(7)).toBe('1');
    expect(built.byPage.get(106)).toBe('100');
    expect(built.byPage.get(107)).toBe('105');
    expect(built.byPage.get(132)).toBe('130');
    expect(built.pages.filter((entry) => entry.segment === 3)).toHaveLength(26);
  });

  it('throws on an invalid declaration instead of half a map', () => {
    expect(() => buildPageLabels([])).toThrow(TypeError);
    expect(() => buildPageLabels([{ from: 1, to: 2 }])).toThrow(/segments 声明不合法/);
  });
});

describe('checkLabelCoverage', () => {
  it('stays quiet when every parsed page is mapped', () => {
    const built = buildPageLabels(THREE_SEGMENTS);
    const allPages = Array.from({ length: 132 }, (_, index) => index + 1);
    expect(checkLabelCoverage(built, allPages, { wholeDocument: true })).toEqual({
      uncoveredPages: [],
      outOfRangePages: [],
      warnings: [],
    });
  });

  it('names the parsed pages a declaration does not cover', () => {
    const built = buildPageLabels([
      { from: 1, to: 2, label: 'i' },
      { from: 5, to: 6, start: 1 },
    ]);
    const coverage = checkLabelCoverage(built, [1, 2, 3, 4, 5]);
    expect(coverage.uncoveredPages).toEqual([3, 4]);
    expect(coverage.warnings).toHaveLength(1);
    expect(coverage.warnings[0]).toContain('第 3-4 页');
    expect(coverage.warnings[0]).toContain('没有印刷页码映射');
  });

  it('records declared pages outside the parsed ones without blaming a subset', () => {
    // "1-6 / 7-106 / 107-132" with only the offprint parsed: every declared page
    // beyond the subset is recorded, but a `pageRanges` request parsing a subset
    // on purpose is not a finding.
    const built = buildPageLabels(THREE_SEGMENTS);
    const coverage = checkLabelCoverage(built, [107, 108]);
    expect(coverage.uncoveredPages).toEqual([]);
    expect(coverage.outOfRangePages).toHaveLength(130);
    expect(coverage.warnings).toEqual([]);
  });

  it('reports a declaration reaching past the whole document', () => {
    const built = buildPageLabels(THREE_SEGMENTS);
    const coverage = checkLabelCoverage(built, [107, 108], { wholeDocument: true });
    expect(coverage.warnings).toHaveLength(1);
    expect(coverage.warnings[0]).toContain('第 1-106、109-132 页');
    expect(coverage.warnings[0]).toContain('超出本次解析的页范围（第 107-108 页）');
  });

  it('makes no claim at all when the parsed pages are unknown', () => {
    const built = buildPageLabels(THREE_SEGMENTS);
    expect(checkLabelCoverage(built, null)).toEqual({ uncoveredPages: [], outOfRangePages: [], warnings: [] });
    expect(checkLabelCoverage(built, [])).toEqual({ uncoveredPages: [], outOfRangePages: [], warnings: [] });
  });
});

describe('toPageLabelMap', () => {
  it('accepts a Map, a plain object and a page/label array', () => {
    expect(toPageLabelMap(labelMap({ 1: 'i' })).get(1)).toBe('i');
    expect(toPageLabelMap({ 2: 'ii' }).get(2)).toBe('ii');
    expect(toPageLabelMap([{ page: 3, label: 'iii' }]).get(3)).toBe('iii');
    expect(toPageLabelMap(null)).toBeNull();
    expect(toPageLabelMap({})).toBeNull();
    expect(toPageLabelMap([{ label: 'i' }])).toBeNull();
  });
});

describe('cross-checking the declaration against the printed numbers', () => {
  it('matches Roman front matter with an Arabic detection', () => {
    const declared = labelMap({ 1: 'i', 2: 'ii', 3: 'iii' });
    const detected = new Map([[1, 1], [2, 2], [3, 3]]);
    const { compared, mismatches } = compareDetectedPageNumbers(declared, detected);
    expect(compared).toBe(3);
    expect(mismatches).toEqual([]);
    expect(formatLabelMismatchWarning(mismatches)).toBeNull();
  });

  it('names the page, the declared label and the detected number', () => {
    const declared = labelMap({ 107: '105', 108: '106' });
    const detected = new Map([[107, 104], [108, 105]]);
    const { compared, mismatches } = compareDetectedPageNumbers(declared, detected);
    expect(compared).toBe(2);
    expect(mismatches).toEqual([
      { page: 107, declared: '105', declaredValue: 105, detected: 104 },
      { page: 108, declared: '106', declaredValue: 106, detected: 105 },
    ]);
    const warning = formatLabelMismatchWarning(mismatches);
    expect(warning).toContain('第 107 页声明为 105，云端识别为 104');
    expect(warning).toContain('共 2 页不一致');
    expect(warning).toContain('请核对声明');
  });

  it('skips pages the cloud did not number and pages the declaration does not cover', () => {
    const declared = labelMap({ 1: 'i' });
    const detected = new Map([[1, 1], [2, 2]]);
    expect(compareDetectedPageNumbers(declared, detected)).toEqual({ compared: 1, mismatches: [] });
    expect(compareDetectedPageNumbers(labelMap({ 1: 'i' }), new Map())).toEqual({ compared: 0, mismatches: [] });
    expect(compareDetectedPageNumbers(labelMap({ 3: 'iii' }), new Map([[3, 9]]))).toEqual({
      compared: 1,
      mismatches: [{ page: 3, declared: 'iii', declaredValue: 3, detected: 9 }],
    });
  });

  it('stays silent when nothing was detected', () => {
    expect(formatLabelMismatchWarning([])).toBeNull();
    expect(formatLabelMismatchWarning(null)).toBeNull();
    expect(formatLabelMismatchWarning(undefined)).toBeNull();
  });

  it('lists at most five mismatches before summarizing', () => {
    const declared = labelMap({ 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7' });
    const detected = new Map([[1, 9], [2, 9], [3, 9], [4, 9], [5, 9], [6, 9], [7, 9]]);
    const warning = formatLabelMismatchWarning(compareDetectedPageNumbers(declared, detected).mismatches);
    expect(warning).toContain('只列前 5 页');
    expect(warning).toContain('共 7 页不一致');
    expect(warning).not.toContain('第 6 页声明为');
  });
});
