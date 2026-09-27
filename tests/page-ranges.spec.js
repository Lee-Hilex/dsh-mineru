import { describe, it, expect } from 'vitest';
import { PageRangeError, canonicalPageSpec, parsePageRanges, planPageChunks } from '../lib/page-ranges.js';

/** The 1-based page list `from..to`. */
const pagesOf = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('parsePageRanges', () => {
  it('parses discrete pages and ranges into one ascending list', () => {
    const spec = parsePageRanges('2,4-6', { totalPages: 10 });
    expect(spec.pages).toEqual([2, 4, 5, 6]);
    expect(spec.canonical).toBe('2,4-6');
    expect(spec.offset).toBe(1);
  });

  it('resolves negative indexes against the document total', () => {
    const spec = parsePageRanges('2--2', { totalPages: 10 });
    expect(spec.pages).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(spec.canonical).toBe('2-9');
  });

  it('accepts a positive start with a negative end covering the document', () => {
    expect(parsePageRanges('1--1', { totalPages: 5 }).canonical).toBe('1-5');
  });

  it('needs the page total before it can resolve a negative index', () => {
    expect(() => parsePageRanges('2--2')).toThrowError(PageRangeError);
  });

  it('rejects overlapping, reversed, zero-based and out-of-range specs', () => {
    expect(() => parsePageRanges('1-5,3-8', { totalPages: 20 })).toThrowError(/重叠|升序/);
    expect(() => parsePageRanges('5-2', { totalPages: 20 })).toThrowError(/倒置/);
    expect(() => parsePageRanges('0-2', { totalPages: 20 })).toThrowError(PageRangeError);
    expect(() => parsePageRanges('9-11', { totalPages: 10 })).toThrowError(/超出文档范围/);
  });
});

describe('planPageChunks', () => {
  it('keeps a request at or below the cap in one chunk', () => {
    expect(planPageChunks(pagesOf(1, 199), 200)).toHaveLength(1);
    expect(planPageChunks(pagesOf(1, 200), 200)).toHaveLength(1);
  });

  it('splits one page over the cap into two chunks', () => {
    const chunks = planPageChunks(pagesOf(1, 201), 200);
    expect(chunks.map((chunk) => chunk.spec)).toEqual(['1-200', '201']);
    expect(chunks[1].pages).toEqual([201]);
    expect(chunks[1].offset).toBe(200);
  });

  it('numbers chunks from one and keeps their page lists contiguous', () => {
    const chunks = planPageChunks(pagesOf(1, 401), 200);
    expect(chunks.map((chunk) => chunk.index)).toEqual([1, 2, 3]);
    expect(chunks.map((chunk) => chunk.spec)).toEqual(['1-200', '201-400', '401']);
    expect(chunks.flatMap((chunk) => chunk.pages)).toEqual(pagesOf(1, 401));
  });

  it('splits a sparse page list without inventing pages', () => {
    const pages = [...pagesOf(1, 150), ...pagesOf(1000, 1100)];
    const chunks = planPageChunks(pages, 200);
    expect(chunks.map((chunk) => chunk.spec)).toEqual(['1-150,1000-1049', '1050-1100']);
    expect(chunks.flatMap((chunk) => chunk.pages)).toEqual(pages);
  });

  it('rejects an empty list and a non-positive cap', () => {
    expect(() => planPageChunks([], 200)).toThrowError(TypeError);
    expect(() => planPageChunks([1], 0)).toThrowError(RangeError);
  });
});

describe('canonicalPageSpec', () => {
  it('collapses consecutive pages into runs', () => {
    expect(canonicalPageSpec([1, 2, 3, 5, 7, 8])).toBe('1-3,5,7-8');
  });

  it('refuses a page list that is not ascending and unique', () => {
    expect(() => canonicalPageSpec([1, 1])).toThrowError(TypeError);
    expect(() => canonicalPageSpec([2, 1])).toThrowError(TypeError);
    expect(() => canonicalPageSpec([])).toThrowError(TypeError);
  });
});
