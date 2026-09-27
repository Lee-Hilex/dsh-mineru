import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { countPdfPages } from '../lib/pdf-pages.js';

/**
 * Byte-level PDF fixture: catalog + page-tree node + `leaves` page objects.
 * The file has no real xref, which is enough for a page-tree scan.
 */
function pdfFixture({ count, leaves }) {
  const objects = Array.from(
    { length: leaves },
    (_, index) => `${index + 3} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 300] >>\nendobj\n`,
  ).join('');
  return Buffer.from(
    '%PDF-1.7\n'
    + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids []' + (count === null ? '' : ' /Count ' + count) + ' >>\nendobj\n'
    + objects
    + '%%EOF\n',
    'latin1',
  );
}

describe('countPdfPages', () => {
  it('reads the page-tree /Count when the tree is uncompressed', () => {
    expect(countPdfPages(pdfFixture({ count: 300, leaves: 2 }))).toEqual({ pages: 300, method: 'count' });
  });

  it('falls back to counting /Type /Page leaves when there is no usable /Count', () => {
    expect(countPdfPages(pdfFixture({ count: null, leaves: 3 }))).toEqual({ pages: 3, method: 'page-objects' });
    expect(countPdfPages(pdfFixture({ count: 0, leaves: 1 }))).toEqual({ pages: 1, method: 'page-objects' });
  });

  it('does not count /Type /Pages tree nodes as page leaves', () => {
    const oneLeaf = pdfFixture({ count: null, leaves: 1 });
    expect(countPdfPages(oneLeaf).pages).toBe(1);
  });

  it('finds a page tree inside a deflate object stream', () => {
    const inner = Buffer.from(
      '4 0 obj\n<< /Type /Pages /Kids [5 0 R] /Count 7 >>\nendobj\n5 0 obj\n<< /Type /Page >>\nendobj\n',
      'latin1',
    );
    const compressed = deflateSync(inner);
    const pdf = Buffer.concat([
      Buffer.from(
        '%PDF-1.5\n'
        + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
        + '2 0 obj\n<< /Type /Pages /Kids [3 0 R] >>\nendobj\n'
        + '3 0 obj\n<< /Type /ObjStm /N 2 /First 0 /Length ' + compressed.length + ' >>\nstream\n',
        'latin1',
      ),
      compressed,
      Buffer.from('endstream\nendobj\n%%EOF\n', 'latin1'),
    ]);
    expect(countPdfPages(pdf)).toEqual({ pages: 7, method: 'count+objstm' });
  });

  it('reports an undetermined count instead of guessing', () => {
    expect(countPdfPages(Buffer.from('not a pdf at all'))).toEqual({ pages: null, method: 'none' });
    expect(countPdfPages(Buffer.alloc(0))).toEqual({ pages: null, method: 'none' });
    expect(countPdfPages(Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'))).toEqual({
      pages: null,
      method: 'none',
    });
  });
});
