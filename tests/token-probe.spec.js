import { describe, expect, it } from 'vitest';
import { TOKEN_PROBE_FILE_NAME, tokenProbePdf } from '../lib/token-probe.js';

describe('token probe PDF', () => {
  it('is a complete single-page PDF', () => {
    const buf = tokenProbePdf();
    const text = buf.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('/Type /Page');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(TOKEN_PROBE_FILE_NAME.endsWith('.pdf')).toBe(true);
  });

  it('returns a fresh buffer every call', () => {
    const first = tokenProbePdf();
    first[0] = 0;
    expect(tokenProbePdf()[0]).toBe(0x25);
  });
});
