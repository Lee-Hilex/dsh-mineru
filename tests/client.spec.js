/** Exercise the shipped browser factory without a DOM renderer or network. */
import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { join } from 'node:path';

async function clientHarness() {
  const disposers = [];
  const slots = [];
  const dictionaries = new Map();
  const register = vi.fn((ns, localeOrDicts, dict) => {
    // Same single-occupant contract as DSH 0.2.0-rc.2's Locale.register.
    const pairs = typeof localeOrDicts === 'string' ? [[localeOrDicts, dict]] : Object.entries(localeOrDicts);
    const keys = pairs.map(([locale]) => ns + '/' + locale);
    if (keys.some((key) => dictionaries.has(key))) throw new Error('duplicate locale namespace');
    pairs.forEach(([locale, value]) => dictionaries.set(ns + '/' + locale, value));
    return () => keys.forEach((key) => dictionaries.delete(key));
  });
  const bind = vi.fn((ns) => (key) => dictionaries.get(ns + '/en')?.[key] ?? key);
  const observe = vi.fn();
  const disconnect = vi.fn();
  const document = { documentElement: {}, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  let bundle;
  const clientPath = process.env.DSH_MINERU_TEST_PACKAGE
    ? join(process.env.DSH_MINERU_TEST_PACKAGE, 'lib/client.js') : new URL('../lib/client.js', import.meta.url);
  runInNewContext(await readFile(clientPath, 'utf8'), {
    window: { __ModuleLoader__: { load: (value) => { bundle = value; } } },
    document,
    MutationObserver: class { observe = observe; disconnect = disconnect; },
  });
  expect(bundle.id).toBe('dsh-mineru');
  const jsx = (type, props) => ({ type, props });
  const react = {
    useState: (value) => [value, () => {}], useEffect: () => {},
    useCallback: (value) => value, useRef: () => ({ current: null }),
  };
  const client = bundle.factory((id) => {
    if (id === 'react') return react;
    if (id === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'fragment' };
    throw new Error('unexpected browser import: ' + id);
  });
  client.apply({
    locale: { register, bind },
    effect: (execute) => { const dispose = execute(); disposers.push(dispose); return dispose; },
    slots: {
      inject(_slot, execute) {
        const result = execute();
        if (typeof result?.[Symbol.iterator] === 'function') disposers.push(...result);
        else disposers.push(result);
      },
      register(meta, component) { slots.push({ meta, component }); return () => {}; },
    },
  });
  return { register, bind, slots, observe, disconnect, document, dictionaries, dispose() {
    for (const dispose of disposers.reverse()) if (typeof dispose === 'function') dispose();
  } };
}

describe('browser bundle contract', () => {
  it('registers each locale once, binds the host language and tears effects down', async () => {
    const harness = await clientHarness();
    try {
      expect(harness.register).toHaveBeenCalledTimes(1);
      expect(harness.bind).toHaveBeenCalledWith('dsh-mineru');
      const settings = harness.slots.find(({ meta }) => meta.name === 'settings.plugins.tab');
      expect(settings.component().props.children).toBe('Loading MinerU settings…');
      expect(harness.slots.filter(({ meta }) => meta.name === 'tool.call.toolview')).toHaveLength(3);
      expect(harness.observe).toHaveBeenCalledTimes(1);
    } finally {
      harness.dispose();
    }
    expect(harness.dictionaries.size).toBe(0);
    expect(harness.disconnect).toHaveBeenCalledTimes(1);
    expect(harness.document.removeEventListener).toHaveBeenCalledTimes(5);
  });
});
