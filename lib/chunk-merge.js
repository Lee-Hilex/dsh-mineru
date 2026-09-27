/**
 * Merging per-chunk results back into one document (pure functions).
 *
 * A request split by `page_ranges` comes back renumbered: the cloud counts the
 * requested subset from 0, so a two-page request for pages 3-4 returns
 * `page_idx` 0 and 1. A block's original page is therefore
 * `requestedPages[page_idx] - 1` (0-based, matching what an unsplit request
 * returns), and every consumer downstream can read the merged file exactly like
 * a single-request result.
 * @module dsh-mineru/chunk-merge
 */

/**
 * Remap one chunk's `content_list.json` blocks onto original page indexes.
 *
 * Blocks whose integer `page_idx` does not land inside the requested page list
 * keep every other field but lose `page_idx`: a page number that does not exist
 * is worse than no page number, because nothing downstream can tell it is wrong.
 * A block without an integer `page_idx` (the cloud emits plain strings for some
 * list items) is passed through untouched.
 *
 * @param {unknown[]} blocks parsed `content_list.json` of one chunk
 * @param {number[]} requestedPages the 1-based page list that chunk was requested with
 * @returns {{blocks: unknown[], outOfRange: number}} mapped blocks and how many
 *   blocks lost their `page_idx`
 */
export function remapChunkPages(blocks, requestedPages) {
  if (!Array.isArray(blocks)) throw new TypeError('blocks must be an array');
  if (!Array.isArray(requestedPages) || requestedPages.length === 0) {
    throw new TypeError('requestedPages must be a non-empty array');
  }
  const out = [];
  let outOfRange = 0;
  for (const block of blocks) {
    // Non-object entries (the cloud emits plain strings for some list items)
    // carry no page index and are passed through untouched.
    if (block === null || typeof block !== 'object' || Array.isArray(block)) {
      out.push(block);
      continue;
    }
    const localPage = block.page_idx;
    if (!Number.isInteger(localPage) || localPage < 0) {
      out.push(block);
      continue;
    }
    const original = requestedPages[localPage];
    if (!Number.isInteger(original)) {
      const rest = { ...block };
      delete rest.page_idx;
      outOfRange += 1;
      out.push(rest);
      continue;
    }
    out.push({ ...block, page_idx: original - 1 });
  }
  return { blocks: out, outOfRange };
}

/**
 * Concatenate per-chunk Markdown with a provenance line before each segment.
 *
 * `full.md` is plain Markdown, so stitching the segments preserves the
 * structure; the comment names the chunk and its page range so a reader can see
 * where one request ended and the next began.
 *
 * @param {Array<{note: string, markdown: string}>} segments in submission order
 * @returns {string}
 */
export function mergeChunksMarkdown(segments) {
  if (!Array.isArray(segments) || segments.length === 0) {
    throw new TypeError('segments must be a non-empty array');
  }
  const parts = [];
  for (const segment of segments) {
    const body = String(segment?.markdown ?? '').replace(/\s+$/, '');
    parts.push('<!-- ' + String(segment?.note ?? '') + ' -->');
    if (body !== '') parts.push('', body);
  }
  return parts.join('\n') + '\n';
}
