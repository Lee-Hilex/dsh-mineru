/**
 * A fake MinerU cloud driven at the **fetch** level: replace global `fetch`
 * with `cloud.fetch` and the real `MineruClient` runs its whole pipeline
 * (submit -> signed upload -> poll -> download -> unzip) with no network and no
 * per-page quota. Test-only.
 *
 * The behaviour deliberately mirrors the observed cloud:
 *  - the submit endpoint resolves which pages from `files[0].page_ranges`;
 *  - `content_list.json` page_idx is renumbered from 0 for the requested
 *    subset;
 *  - early polls answer `running`; the settled poll carries `full_zip_url`.
 */
import { buildZip, buildCloudZip, expandPageSpec } from './zip.js';

const jsonResponse = (obj, init = {}) =>
  new Response(JSON.stringify(obj), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

const zipResponse = (buffer) =>
  new Response(buffer, { status: 200, headers: { 'Content-Type': 'application/zip' } });

/**
 * @param {object} options
 * @param {number} options.totalPages physical page count of the source document
 * @param {number} [options.pollUntilDone] poll count at which a batch settles
 * @param {{ code: number, msg: string } | null} [options.failWith] every batch fails with this
 * @param {string[]} [options.failSpecs] live array; batches whose spec matches fail
 * @param {boolean} [options.withContentList] include content_list.json in the result zip
 * @param {number} [options.extraImages] extra images beyond the default one
 * @param {string | null} [options.extraEntry] extra (possibly malformed) zip entry name
 * @param {Buffer | null} [options.zipBytes] serve this exact zip (corrupt-archive tests)
 * @param {Array<Record<string, unknown>> | null} [options.contentList] replace the synthetic content list (real-product replay)
 * @param {string} [options.fileName] file_name echoed back in extract_result
 */
export function makeFakeCloud(options) {
  const {
    totalPages,
    pollUntilDone = 2,
    failWith = null,
    failSpecs = [],
    withContentList = true,
    extraImages = 0,
    extraEntry = null,
    zipBytes = null,
    contentList = null,
    fileName = 'x.pdf',
  } = options;

  const uploadBase = 'https://upload.test/';
  const zipBase = 'https://zip.test/';
  const uuid = '11111111-2222-3333-4444-555555555555';
  /** @type {Map<string, {spec: string|null, polls: number, pages: number[], dataId: string|undefined}>} */
  const batches = new Map();
  /** Counters let assertions watch for re-upload / re-download directly. */
  const calls = { submit: [], upload: [], poll: [], download: [] };

  /** @param {string} url @param {RequestInit} [init] */
  const fetchImpl = async (url, init = {}) => {
    const target = String(url);
    const method = init.method ?? 'GET';

    // 1) Request one signed upload URL (per chunk).
    if (target.endsWith('/file-urls/batch') && method === 'POST') {
      const payload = JSON.parse(String(init.body));
      calls.submit.push(payload);
      const batchId = 'batch-' + calls.submit.length;
      const spec = payload.files[0].page_ranges ?? null;
      const pages = expandPageSpec(spec, totalPages);
      batches.set(batchId, { spec, polls: 0, pages, dataId: payload.files[0].data_id });
      return jsonResponse({
        code: 0, msg: 'ok', trace_id: 'trace-' + batchId,
        data: { batch_id: batchId, file_urls: [uploadBase + batchId] },
      });
    }

    // 2) PUT the file to the signed URL (no auth). Drain the body so the real
    //    read stream is consumed and its length can be asserted.
    if (target.startsWith(uploadBase)) {
      let bytes = 0;
      if (init.body && typeof init.body.getReader === 'function') {
        const reader = init.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
        }
      } else if (typeof init.body === 'string') {
        bytes = Buffer.byteLength(init.body);
      }
      calls.upload.push({ url: target, bytes });
      return new Response('OK', { status: 200, headers: { 'Content-Type': 'text/plain' } });
    }

    // 3) Poll the batch result.
    if (target.includes('/extract-results/batch/')) {
      const batchId = decodeURIComponent(target.split('/').pop());
      calls.poll.push(batchId);
      const batch = batches.get(batchId);
      if (!batch) {
        return new Response('not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
      }
      batch.polls += 1;
      const failedBySpec = Array.isArray(failSpecs) && failSpecs.includes(batch.spec);
      if ((failWith !== null || failedBySpec) && batch.polls >= pollUntilDone) {
        const failure = failWith ?? { code: -60018, msg: 'daily limit reached' };
        return jsonResponse({
          code: 0, msg: 'ok',
          data: { extract_result: [{ file_name: fileName, state: 'failed', err_code: failure.code, err_msg: failure.msg }] },
        });
      }
      if (batch.polls < pollUntilDone) {
        return jsonResponse({
          code: 0, msg: 'ok',
          data: {
            extract_result: [{
              file_name: fileName, state: 'running',
              extract_progress: { extracted_pages: 1, total_pages: batch.pages.length },
            }],
          },
        });
      }
      return jsonResponse({
        code: 0, msg: 'ok', trace_id: 'trace-' + batchId,
        data: {
          extract_result: [{
            file_name: fileName, state: 'done', data_id: batch.dataId,
            full_zip_url: zipBase + batchId + '.zip',
          }],
        },
      });
    }

    // 4) Download the result zip.
    if (target.startsWith(zipBase)) {
      const batchId = target.split('/').pop().replace('.zip', '');
      calls.download.push(target);
      const batch = batches.get(batchId);
      if (zipBytes) return zipResponse(zipBytes);
      if (contentList !== null) {
        const entries = [{ name: uuid + '_content_list.json', data: JSON.stringify(contentList) }];
        const mdLines = [];
        for (const block of contentList) {
          if (block && typeof block === 'object' && typeof block.img_path === 'string' && block.img_path !== '') {
            entries.push({ name: block.img_path, data: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
          }
          if (block && (block.type === 'text' || block.type === 'title')) {
            const text = typeof block.text === 'string' ? block.text : '';
            if (text) mdLines.push(text);
          }
        }
        entries.unshift({ name: 'full.md', data: mdLines.join('\n\n') + '\n' });
        return zipResponse(buildZip(entries));
      }
      return zipResponse(buildCloudZip(batch.pages, {
        uuid, withContentList, images: 1 + extraImages, extraEntry,
      }));
    }

    throw new Error('fake cloud: unrouted request ' + method + ' ' + target);
  };

  return { fetch: fetchImpl, calls, batches };
}
