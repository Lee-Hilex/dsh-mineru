/**
 * Unit tests for the pure settings-view logic embedded in the browser bundle.
 *
 * lib/client.js is a single-file browser bundle, so the helpers cannot be
 * imported from Node. They are delimited by stable marker comments; this spec
 * slices that exact block out of the shipped source and evaluates it with the
 * one constant the factory would inject, so the tested code IS the shipped
 * code (no duplicated copy to drift).
 */
import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

const START = '// --- settings-view helpers start';
const END = '// --- settings-view helpers end';
const EXTRA_FORMATS = ['docx', 'html', 'latex'];

async function loadSettingsView() {
  const clientPath = process.env.DSH_MINERU_TEST_PACKAGE
    ? process.env.DSH_MINERU_TEST_PACKAGE + '/lib/client.js' : new URL('../lib/client.js', import.meta.url);
  const source = await readFile(clientPath, 'utf8');
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  expect(start, 'helpers start marker present').toBeGreaterThan(-1);
  expect(end, 'helpers end marker present').toBeGreaterThan(start);
  const block = source.slice(start, end);
  const makeSettingsView = new Function('EXTRA_FORMATS', block + '\nreturn makeSettingsView;')(EXTRA_FORMATS);
  return makeSettingsView(EXTRA_FORMATS);
}

describe('settings-view normalizeFormats', () => {
  it('collapses undefined / null / non-list values to an empty array', async () => {
    const view = await loadSettingsView();
    expect(view.normalizeFormats(undefined)).toEqual([]);
    expect(view.normalizeFormats(null)).toEqual([]);
    expect(view.normalizeFormats({})).toEqual([]);
    expect(view.normalizeFormats(42)).toEqual([]);
  });

  it('filters arrays to the allowed members', async () => {
    const view = await loadSettingsView();
    expect(view.normalizeFormats(['docx', 'html', 'latex'])).toEqual(['docx', 'html', 'latex']);
    expect(view.normalizeFormats(['docx'])).toEqual(['docx']);
    expect(view.normalizeFormats([])).toEqual([]);
    expect(view.normalizeFormats(['docx', 'bogus', 'latex'])).toEqual(['docx', 'latex']);
  });

  it('parses every plausible string shape (scalar, comma/space list, YAML-ish lines)', async () => {
    const view = await loadSettingsView();
    expect(view.normalizeFormats('docx')).toEqual(['docx']);
    expect(view.normalizeFormats('docx,html,latex')).toEqual(['docx', 'html', 'latex']);
    expect(view.normalizeFormats('docx html latex')).toEqual(['docx', 'html', 'latex']);
    expect(view.normalizeFormats('- docx\n- html\n- latex')).toEqual(['docx', 'html', 'latex']);
    expect(view.normalizeFormats('docx, bogus latex')).toEqual(['docx', 'latex']);
    expect(view.normalizeFormats('')).toEqual([]);
    expect(view.normalizeFormats('   ')).toEqual([]);
  });

  it('is stable across the report shapes: membership matches the canonical array', async () => {
    const view = await loadSettingsView();
    for (const raw of [['docx', 'html', 'latex'], 'docx,html,latex', '- html\n- latex']) {
      const canonical = view.normalizeFormats(raw);
      const expected = raw === '- html\n- latex' ? ['html', 'latex'] : ['docx', 'html', 'latex'];
      expect(EXTRA_FORMATS.map((f) => expected.indexOf(f) >= 0))
        .toEqual(EXTRA_FORMATS.map((f) => canonical.indexOf(f) >= 0));
    }
  });
});

describe('settings-view isDirty (baseline delta)', () => {
  it('never reports dirty before a baseline exists or with zero edits', async () => {
    const view = await loadSettingsView();
    expect(view.isDirty(null, { mode: 'auto' })).toBe(false);
    const value = { mode: 'auto', extraFormats: [] };
    expect(view.isDirty(JSON.stringify(value), value)).toBe(false);
    expect(view.isDirty(JSON.stringify(value), { ...value })).toBe(false);
  });

  it('reports dirty exactly when a field differs from the baseline', async () => {
    const view = await loadSettingsView();
    const base = { mode: 'auto', extraFormats: [] };
    expect(view.isDirty(JSON.stringify(base), { ...base, mode: 'agent' })).toBe(true);
    expect(view.isDirty(JSON.stringify(base), { ...base, extraFormats: ['docx'] })).toBe(true);
    expect(view.isDirty('"strict"', undefined)).toBe(true); // baseline present, value vanished
    expect(view.isDirty(JSON.stringify({}), {})).toBe(false);
  });
});