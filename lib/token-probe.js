/** 
 * Embedded one-page probe PDF for the Settings card "test token" action.
 *
 * Historically the test submitted the vendor demo URL
 * (`cdn-mineru.openxlab.org.cn/demo/example.pdf`) through URL mode. That
 * fixture now answers `-60017 retry limit reached (5 attempts), please replace
 * the file`, so a perfectly healthy token reported a failed test, and the test
 * depended on a third-party file staying online.
 *
 * Shipping the bytes keeps the probe hermetic: write it to a temp file, upload
 * it through the precision API, poll to `done`. That exercises token validity,
 * the signed-PUT upload, the batch poll and the zip download in one call, and
 * costs one page of quota instead of depending on any remote fixture.
 *
 * @module dsh-mineru/token-probe
 */

/** Base64 of a single-page PDF with four lines of Helvetica text. */
const PROBE_PDF_BASE64 = [
  'JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj',
  '4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEg',
  'Pj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3',
  'ggWzAgMCA1OTUgODQyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA0IDAgUiA+PiA+PiAv',
  'Q29udGVudHMgNSAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL1R5cGUgL0ZvbnQgL1N1YnR5cG',
  'UgL1R5cGUxIC9CYXNlRm9udCAvSGVsdmV0aWNhID4+CmVuZG9iago1IDAgb2JqCjw8IC9MZW5n',
  'dGggMjc5ID4+CnN0cmVhbQpCVAovRjEgMTggVGYKNzIgNzIwIFRkCihkc2gtbWluZXJ1IHRva2',
  'VuIHRlc3QpIFRqCjAgLTI4IFRkCi9GMSAxMSBUZgooVGhpcyBvbmUtcGFnZSBQREYgaXMgZ2Vu',
  'ZXJhdGVkIGJ5IHRoZSBwbHVnaW4gYW5kIHBhcnNlZCB0aHJvdWdoIHRoZSkgVGoKMCAtMTYgVG',
  'QKKE1pbmVyVSBwcmVjaXNpb24gQVBJLiBBIHN1Y2Nlc3NmdWwgcGFyc2UgcHJvdmVzIHRoZSB0',
  'b2tlbiwgdGhlIHVwbG9hZCkgVGoKMCAtMTYgVGQKKHBhdGggYW5kIHRoZSBwb2xsaW5nIGxvb3',
  'AgYWxsIHdvcmsuKSBUagpFVAplbmRzdHJlYW0KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAg',
  'NjU1MzUgZiAKMDAwMDAwMDAxNSAwMDAwMCBuIAowMDAwMDAwMDY0IDAwMDAwIG4gCjAwMDAwMD',
  'AxMjEgMDAwMDAgbiAKMDAwMDAwMDI0NyAwMDAwMCBuIAowMDAwMDAwMzE3IDAwMDAwIG4gCnRy',
  'YWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNjQ2CiUlRU9GCg==',
].join('');

/** File name used for the uploaded probe; also the artifact stem MinerU reports. */
export const TOKEN_PROBE_FILE_NAME = 'dsh-mineru-token-test.pdf';

/**
 * A fresh copy of the probe bytes. A Buffer (not a string) so the upload path
 * can stream it unchanged and callers cannot mutate the shared constant.
 * @returns {Buffer}
 */
export function tokenProbePdf() {
  return Buffer.from(PROBE_PDF_BASE64, 'base64');
}
