import { describe, it, expect } from 'vitest';
import { mergeChunksMarkdown, remapChunkPages } from '../lib/chunk-merge.js';

/** The 1-based page list `from..to`. */
const pagesOf = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

describe('remapChunkPages', () => {
  it('maps a chunk subset index back to the original page', () => {
    const { blocks, outOfRange } = remapChunkPages(
      [{ type: 'text', page_idx: 0 }, { type: 'text', page_idx: 1 }],
      [3, 4],
    );
    expect(blocks).toEqual([{ type: 'text', page_idx: 2 }, { type: 'text', page_idx: 3 }]);
    expect(outOfRange).toBe(0);
  });

  it('maps a non-contiguous request through its own page list', () => {
    const { blocks } = remapChunkPages(
      [{ page_idx: 0 }, { page_idx: 1 }, { page_idx: 2 }],
      [1, 5, 9],
    );
    expect(blocks.map((block) => block.page_idx)).toEqual([0, 4, 8]);
  });

  it('drops an unmappable page index instead of writing a wrong page', () => {
    const { blocks, outOfRange } = remapChunkPages([{ type: 'text', page_idx: 7, text: 'x' }], [201, 202]);
    expect(blocks).toEqual([{ type: 'text', text: 'x' }]);
    expect(outOfRange).toBe(1);
  });

  it('passes through blocks that carry no page index', () => {
    const input = [null, 'plain string', { type: 'image' }, { page_idx: -1 }];
    expect(remapChunkPages(input, [10]).blocks).toEqual(input);
  });

  it('leaves the merged page numbers continuous and offset-free', () => {
    const first = remapChunkPages([{ page_idx: 0 }, { page_idx: 199 }], pagesOf(1, 200)).blocks;
    const second = remapChunkPages([{ page_idx: 0 }, { page_idx: 100 }], pagesOf(201, 301)).blocks;
    expect([...first, ...second].map((block) => block.page_idx)).toEqual([0, 199, 200, 300]);
  });

  it('rejects malformed input', () => {
    expect(() => remapChunkPages('nope', [1])).toThrowError(TypeError);
    expect(() => remapChunkPages([], [])).toThrowError(TypeError);
  });
});

describe('mergeChunksMarkdown', () => {
  it('labels every segment and preserves order and content', () => {
    const merged = mergeChunksMarkdown([
      { note: 'chunk 1/2: pages 1-200', markdown: '# Part A\n\nbody A\n' },
      { note: 'chunk 2/2: pages 201-300', markdown: '# Part B' },
    ]);
    const firstNote = merged.indexOf('<!-- chunk 1/2: pages 1-200 -->');
    const secondNote = merged.indexOf('<!-- chunk 2/2: pages 201-300 -->');
    expect(firstNote).toBeGreaterThanOrEqual(0);
    expect(firstNote).toBeLessThan(merged.indexOf('# Part A'));
    expect(merged.indexOf('# Part A')).toBeLessThan(secondNote);
    expect(secondNote).toBeLessThan(merged.indexOf('# Part B'));
    expect(merged.endsWith('# Part B\n')).toBe(true);
  });

  it('emits only the label for an empty segment', () => {
    expect(mergeChunksMarkdown([{ note: 'empty chunk', markdown: '' }])).toBe('<!-- empty chunk -->\n');
  });

  it('rejects an empty segment list', () => {
    expect(() => mergeChunksMarkdown([])).toThrowError(TypeError);
  });
});
