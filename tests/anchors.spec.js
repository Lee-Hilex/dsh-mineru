/**
 * Page-anchored Markdown (`document.md`).
 *
 * Everything here is synthetic on purpose: the anchors are pure functions of
 * `content_list.json`, so a handful of hand-written blocks pins the contract
 * (1-based pages, per-page block counters, request-relative `page_idx`) without
 * shipping anybody's scanned document into the repository.
 */
import { describe, it, expect } from 'vitest';
import {
  BODY_TYPES,
  UNREADABLE_MARKER,
  classifyBlockType,
  extractText,
  isUnreadableText,
  parseRequestedPages,
  synthesizeDocument,
} from '../lib/anchors.js';

/** Two pages, three blocks on page 1 (one of them a page header), two on page 2. */
const CONTENT_LIST = [
  { type: 'header', text: '中国哲学史大纲 第一编', bbox: [117, 55, 309, 71], page_idx: 0 },
  { type: 'text', text: '君子务本，本立而道生。', bbox: [114, 105, 544, 122], page_idx: 0 },
  { type: 'page_number', text: '1', bbox: [521, 938, 547, 952], page_idx: 0 },
  { type: 'text', text: '有子曰：其为人也孝弟。', bbox: [114, 125, 544, 142], page_idx: 0 },
  {
    type: 'table',
    table_body: '<table><tr><td>姓名</td></tr></table>',
    table_caption: ['表一 孔门弟子年表'],
    table_footnote: [],
    bbox: [117, 209, 875, 325],
    page_idx: 1,
  },
  { type: 'image', img_path: 'images/abc123.jpg', bbox: [100, 300, 400, 500], page_idx: 1 },
];

describe('block classification and text extraction', () => {
  it('separates body, auxiliary and unknown block types', () => {
    expect(classifyBlockType('text')).toBe('body');
    expect(classifyBlockType('table')).toBe('body');
    expect(classifyBlockType('image')).toBe('body');
    expect(classifyBlockType('header')).toBe('aux');
    expect(classifyBlockType('footer')).toBe('aux');
    expect(classifyBlockType('page_number')).toBe('aux');
    expect(classifyBlockType('aside_text')).toBe('aux');
    expect(classifyBlockType('some_new_type')).toBe('other');
    expect(classifyBlockType('')).toBe('other');
  });

  it('lists text/title/list/code/ref_text/equation among the body types', () => {
    for (const type of ['text', 'title', 'paragraph_title', 'list', 'code', 'ref_text', 'equation']) {
      expect(BODY_TYPES).toContain(type);
    }
  });

  it('flattens arrays and nested content shapes', () => {
    expect(extractText(['表一', '孔门弟子年表'])).toBe('表一\n孔门弟子年表');
    expect(extractText({ paragraph_content: [{ type: 'text', content: '君子务本' }] })).toBe('君子务本');
    expect(extractText(null)).toBe('');
  });

  it('detects the cloud unreadable marker only when nothing else is left', () => {
    expect(isUnreadableText(UNREADABLE_MARKER)).toBe(true);
    expect(isUnreadableText(`  ${UNREADABLE_MARKER}  `)).toBe(true);
    expect(isUnreadableText(`正常文字 ${UNREADABLE_MARKER}`)).toBe(false);
    expect(isUnreadableText('')).toBe(false);
  });
});

describe('page anchors', () => {
  it('numbers pages from 1 and counts blocks per page in content-list order', () => {
    const { markdown, stats } = synthesizeDocument(CONTENT_LIST);
    expect(markdown).toContain('<!-- p1 b2 -->\n君子务本，本立而道生。');
    // the page header (b1) and the page number (b3) took numbers, so the
    // second rendered block on page 1 is b4 — the gap is the point
    expect(markdown).toContain('<!-- p1 b4 -->\n有子曰：其为人也孝弟。');
    expect(markdown).toContain('<!-- p2 b1 -->');
    expect(markdown).toContain('<!-- p2 b2 -->');
    expect(stats.pageNumbers).toEqual([1, 2]);
    expect(stats.auxBlocks).toBe(2);
    expect(stats.bodyBlocks).toBe(4);
  });

  it('keeps auxiliary blocks counted but out of the body stream', () => {
    const { markdown, anchors } = synthesizeDocument(CONTENT_LIST);
    expect(markdown).not.toContain('中国哲学史大纲');
    expect(markdown).not.toContain('<!-- p1 b1 -->');
    expect(anchors.filter((anchor) => anchor.emitted === false).map((anchor) => anchor.index)).toEqual([1, 3]);
  });

  it('emits anchors in content-list order', () => {
    const { markdown } = synthesizeDocument(CONTENT_LIST);
    const order = [...markdown.matchAll(/<!-- p(\d+) b(\d+) -->/g)].map((match) => match[2]);
    expect(order).toEqual(['2', '4', '1', '2']);
  });
});

describe('request-relative page_idx (page_ranges)', () => {
  it('maps a discrete subset back to the original page numbers', () => {
    // "2,4-6" => the request covered [2,4,5,6]; page_idx 0..3 are those pages
    const { markdown, stats } = synthesizeDocument(
      [
        { type: 'text', text: '第二页', page_idx: 0 },
        { type: 'text', text: '第四页', page_idx: 1 },
        { type: 'text', text: '第五页', page_idx: 2 },
        { type: 'text', text: '第六页', page_idx: 3 },
      ],
      { pageRanges: '2,4-6' },
    );
    expect(markdown).toContain('<!-- p2 b1 -->\n第二页');
    expect(markdown).toContain('<!-- p4 b1 -->\n第四页');
    expect(markdown).toContain('<!-- p5 b1 -->\n第五页');
    expect(markdown).toContain('<!-- p6 b1 -->\n第六页');
    expect(stats.pageNumbers).toEqual([2, 4, 5, 6]);
  });

  it('an offset alone is not enough for a discrete range (the bug this avoids)', () => {
    const { markdown } = synthesizeDocument(
      [
        { type: 'text', text: '第三页', page_idx: 0 },
        { type: 'text', text: '第七页', page_idx: 1 },
      ],
      { pageRanges: '3,7' },
    );
    expect(markdown).toContain('<!-- p3 b1 -->');
    expect(markdown).toContain('<!-- p7 b1 -->');
    expect(markdown).not.toContain('<!-- p4 b1 -->');
  });

  it('accepts pageNumbers directly and prefers them over pageOffset', () => {
    const { markdown } = synthesizeDocument(
      [
        { type: 'text', text: 'a', page_idx: 0 },
        { type: 'text', text: 'b', page_idx: 1 },
      ],
      { pageNumbers: [9, 12], pageOffset: 0 },
    );
    expect(markdown).toContain('<!-- p9 b1 -->');
    expect(markdown).toContain('<!-- p12 b1 -->');
  });

  it('falls back to an offset when a negative page index cannot be resolved', () => {
    const { markdown, warnings } = synthesizeDocument(
      [
        { type: 'text', text: 'a', page_idx: 0 },
        { type: 'text', text: 'b', page_idx: 1 },
      ],
      { pageRanges: '5,7--2' },
    );
    expect(warnings.some((warning) => warning.includes('倒数页码'))).toBe(true);
    expect(markdown).toContain('<!-- p5 b1 -->');
    expect(markdown).toContain('<!-- p6 b1 -->');
  });

  it('degrades to p? instead of dropping blocks it cannot place', () => {
    const { markdown, warnings } = synthesizeDocument([
      { type: 'text', text: '没有页码', bbox: [1, 2, 3, 4] },
    ]);
    expect(markdown).toContain('<!-- p? b1 -->\n没有页码');
    expect(warnings.some((warning) => warning.includes('page_idx'))).toBe(true);
  });
});

describe('parseRequestedPages', () => {
  it('expands comma-separated ranges', () => {
    expect(parseRequestedPages('2,4-6')).toMatchObject({ pages: [2, 4, 5, 6], canonical: '2,4-6' });
  });

  it('sorts and de-duplicates', () => {
    expect(parseRequestedPages('6,2-4,2').pages).toEqual([2, 3, 4, 6]);
  });

  it('resolves negative indexes when the total page count is known', () => {
    const parsed = parseRequestedPages('2--2', { totalPages: 10 });
    expect(parsed.pages).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(parsed.unresolvedNegative).toBe(false);
  });

  it('reports unresolved negative indexes instead of guessing silently', () => {
    const parsed = parseRequestedPages('2--2');
    expect(parsed.unresolvedNegative).toBe(true);
    expect(parsed.pages).toEqual([]);
    expect(parsed.warnings.join('')).toContain('倒数页码');
  });

  it('rejects an empty spec', () => {
    expect(() => parseRequestedPages('')).toThrow(TypeError);
  });
});

describe('block rendering', () => {
  it('renders a table as its caption plus table_body', () => {
    const { markdown } = synthesizeDocument(CONTENT_LIST);
    expect(markdown).toContain('<!-- p2 b1 -->\n**表一 孔门弟子年表**\n\n<table><tr><td>姓名</td></tr></table>');
  });

  it('renders an image as a reference to the img_path the cloud gave', () => {
    const { markdown } = synthesizeDocument(CONTENT_LIST);
    expect(markdown).toContain('![image](images/abc123.jpg)');
  });

  it('renders a table without table_body as a placeholder instead of dropping the anchor', () => {
    const { markdown, warnings } = synthesizeDocument([
      { type: 'table', table_caption: ['只有标题'], page_idx: 0 },
    ]);
    expect(markdown).toContain('<!-- p1 b1 -->');
    expect(markdown).toContain(UNREADABLE_MARKER);
    expect(warnings.some((warning) => warning.includes('table_body'))).toBe(true);
  });

  it('maps text_level onto Markdown headings', () => {
    const { markdown } = synthesizeDocument([
      { type: 'text', text: '孔门弟子年表', text_level: 2, page_idx: 0 },
    ]);
    expect(markdown).toContain('## 孔门弟子年表');
  });

  it('fences equations with their text_format', () => {
    const { markdown } = synthesizeDocument([
      { type: 'equation', text: 'a^2+b^2=c^2', text_format: 'latex', page_idx: 0 },
    ]);
    expect(markdown).toContain('```latex\na^2+b^2=c^2\n```');
  });
});

describe('unreadable and empty blocks', () => {
  it('keeps the anchor and a placeholder for cloud-marked unreadable blocks', () => {
    const { markdown, stats, warnings } = synthesizeDocument([
      { type: 'text', text: '可读正文', page_idx: 0 },
      { type: 'text', text: UNREADABLE_MARKER, bbox: [1, 2, 3, 4], page_idx: 0 },
      { type: 'text', text: '[Unreadable]', bbox: [1, 2, 3, 4], page_idx: 0 },
    ]);
    expect(markdown).toContain('<!-- p1 b2 -->\n' + UNREADABLE_MARKER);
    expect(markdown).toContain('<!-- p1 b3 -->\n' + UNREADABLE_MARKER);
    expect(stats.unreadableBlocks).toBe(2);
    expect(warnings.some((warning) => warning.includes('不可读'))).toBe(true);
  });

  it('keeps the anchor of a block whose text is empty', () => {
    const { markdown, stats } = synthesizeDocument([
      { type: 'text', text: '', bbox: [660, 151, 859, 918], page_idx: 0 },
      { type: 'text', text: '下一页正文', page_idx: 1 },
    ]);
    expect(markdown).toContain('<!-- p1 b1 -->');
    expect(markdown).toContain('<!-- p2 b1 -->\n下一页正文');
    expect(stats.bodyBlocks).toBe(2);
    expect(stats.charCountByPage).toEqual([{ page: 1, chars: 0 }, { page: 2, chars: 5 }]);
  });
});

describe('output contract', () => {
  it('is deterministic', () => {
    expect(synthesizeDocument(CONTENT_LIST).markdown).toBe(synthesizeDocument(CONTENT_LIST).markdown);
  });

  it('produces empty Markdown for an empty content list', () => {
    const { markdown, stats } = synthesizeDocument([]);
    expect(markdown).toBe('');
    expect(stats.blocks).toBe(0);
  });

  it('validates its input', () => {
    expect(() => synthesizeDocument(null)).toThrow(TypeError);
    expect(() => synthesizeDocument({})).toThrow(TypeError);
  });

  it('closes every emitted block with a trailing newline', () => {
    const { markdown } = synthesizeDocument([{ type: 'text', text: 'a', page_idx: 0 }]);
    expect(markdown.endsWith('\n')).toBe(true);
    expect(markdown.endsWith('\n\n')).toBe(false);
  });
});
