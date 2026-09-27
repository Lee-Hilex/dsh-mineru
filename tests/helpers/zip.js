/**
 * Test-only helpers: hand-build valid ZIP archives (fake MinerU result
 * packages), a minimal parseable PDF, and page-spec expansion. NOT part of the
 * plugin runtime — never import from lib/.
 */
import { deflateRawSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let crc = n;
    for (let k = 0; k < 8; k++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[n] = crc >>> 0;
  }
  return table;
})();

/** Standard CRC-32 (IEEE), as stored in ZIP entries. */
export function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a valid ZIP. `overrides` deliberately corrupts declared sizes.
 * @param {Array<{ name: string, data?: string | Buffer, method?: number, crc?: number }>} entries
 * @param {{ uncompressedSize?: number, compressedSize?: number }} [overrides]
 * @returns {Buffer}
 */
export function buildZip(entries, overrides = {}) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '', 'utf8');
    const method = entry.method ?? 8;
    const compressed = method === 8 ? deflateRawSync(data) : data;
    const crc = entry.crc ?? crc32(data);
    const declaredUncompressed = overrides.uncompressedSize ?? data.length;
    const declaredCompressed = overrides.compressedSize ?? compressed.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuffer, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(declaredCompressed, 20);
    central.writeUInt32LE(declaredUncompressed, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

/**
 * Minimal parseable PDF (page tree + page objects).
 * @param {{ pages?: number, width?: number, height?: number }} [options]
 * @returns {Buffer}
 */
export function buildPdf(options = {}) {
  const { pages = 1, width = 595.2, height = 841.9 } = options;
  const kids = [];
  const pageObjects = [];
  for (let index = 0; index < pages; index += 1) {
    const objectNumber = index + 3;
    kids.push(objectNumber + ' 0 R');
    pageObjects.push(
      objectNumber + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + width + ' ' + height + '] >>\nendobj\n',
    );
  }
  const head = '%PDF-1.7\n'
    + '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n'
    + '2 0 obj\n<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages + ' >>\nendobj\n';
  return Buffer.from(
    head + pageObjects.join('') + 'trailer\n<< /Size ' + (pages + 3) + ' /Root 1 0 R >>\n%%EOF\n',
    'latin1',
  );
}

/**
 * Build a "cloud result package": `*_content_list.json` with `page_idx`
 * numbered from 0 for the requested subset (mirrors observed cloud behaviour),
 * plus full.md / layout.json / model.json / images.
 * @param {number[]} requestedPages original pages covered by this request
 * @param {{ uuid?: string, withContentList?: boolean, images?: number, extraEntry?: string }} [options]
 * @returns {Buffer}
 */
export function buildCloudZip(requestedPages, options = {}) {
  const {
    uuid = '11111111-2222-3333-4444-555555555555',
    withContentList = true,
    images = 1,
    extraEntry = null,
  } = options;
  const contentList = [];
  requestedPages.forEach((page, index) => {
    contentList.push({ type: 'text', text: '第 ' + page + ' 页正文', bbox: [10, 20, 900, 60], page_idx: index });
    contentList.push({ type: 'page_number', text: String(page), bbox: [10, 950, 40, 970], page_idx: index });
  });
  const entries = [
    {
      name: 'full.md',
      data: '# 第 ' + requestedPages[0] + ' 页起\n\n'
        + requestedPages.map((page) => '第 ' + page + ' 页正文').join('\n\n') + '\n',
    },
    {
      name: 'layout.json',
      data: JSON.stringify({ pdf_info: requestedPages.map((page, index) => ({ page_idx: index, page_size: [595, 842] })) }),
    },
    { name: uuid + '_origin.pdf', data: Buffer.from('%PDF-1.7\nrebuilt\n', 'latin1') },
  ];
  if (withContentList) entries.push({ name: uuid + '_content_list.json', data: JSON.stringify(contentList) });
  entries.push({ name: uuid + '_model.json', data: JSON.stringify({ model: 'vlm', pages: requestedPages.length }) });
  for (let index = 0; index < images; index += 1) {
    entries.push({ name: 'images/img-' + (index + 1) + '.jpg', data: Buffer.from('fake-jpeg-' + (index + 1), 'utf8') });
  }
  if (extraEntry) entries.push({ name: extraEntry, data: 'unknown' });
  return buildZip(entries);
}

/**
 * Expand a page_ranges string (test-side minimal impl): "1-4" / "1,5".
 * @param {string | null | undefined} spec
 * @param {number} totalPages
 * @returns {number[]}
 */
export function expandPageSpec(spec, totalPages) {
  if (spec === null || spec === undefined || spec === '' || spec === 'all') {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages = [];
  for (const token of String(spec).split(',')) {
    const trimmed = token.trim();
    const match = /^(\d+)(?:-(\d+))?$/.exec(trimmed);
    if (!match) throw new Error('test helper: unsupported range syntax ' + trimmed);
    const start = Number(match[1]);
    const end = match[2] === undefined ? start : Number(match[2]);
    for (let page = start; page <= end; page += 1) pages.push(page);
  }
  return pages;
}
