/**
 * Regression coverage for issue #22: the REAL DSH 0.2.0-rc.2 settings service
 * must round-trip list fields (extraFormats) exactly through the plugin's
 * /plugin/mineru/config routes, using the same full-state patch the settings
 * card sends, and consecutive reads must be byte-identical (the baseline the
 * card derives its dirty indicator from).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { CredentialProvider } from '@deepseek-ai/dsh-credentials';

const require = createRequire(import.meta.url);
const packageDir = process.env.DSH_MINERU_TEST_PACKAGE;
const pluginPath = packageDir
  ? pathToFileURL(join(packageDir, 'lib/index.js')).href
  : new URL('../lib/index.js', import.meta.url).href;
const installAnchor = fileURLToPath(new URL('../package.json', import.meta.url));

class MemoryCredentials extends CredentialProvider {
  values = new Map();
  async resolve(ref) { const v = this.values.get(ref); return v === undefined ? undefined : { value: v, source: 'test' }; }
  async describe(ref) { return { configured: this.values.has(ref), writable: true, source: 'test' }; }
  async set(ref, value) { this.values.set(ref, value); }
  async unset(ref) { this.values.delete(ref); }
}

const hosts = [];
const dirs = [];
afterEach(async () => {
  for (const ctx of hosts.splice(0)) await ctx.fiber.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function startHost() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mineru-settings-'));
  dirs.push(dir);
  const configPath = join(dir, 'cordis.yml');
  const patchPath = join(dir, 'cordis.patch.yml');
  const entries = [
    { id: 'system-prompt', name: '@deepseek-ai/dsh-system-prompt', config: {} },
    { id: 'tools', name: '@deepseek-ai/dsh-tools', config: {} },
    { id: 'skills', name: '@deepseek-ai/dsh-skill', config: {} },
    { id: 'agents', name: '@deepseek-ai/dsh-agent', config: {} },
    { id: 'config-editor', name: '@deepseek-ai/dsh-config-editor', config: {} },
    { id: 'settings', name: '@deepseek-ai/dsh-settings', config: {} },
    { id: 'webserver', name: '@deepseek-ai/dsh-host-webserver', config: { host: '127.0.0.1', port: 0 } },
    { id: 'mineru-renamed', name: pluginPath, config: {} },
  ];
  const home = join(dir, 'home');
  await mkdir(home);
  await writeFile(configPath, '[]\n');
  await writeFile(patchPath, JSON.stringify([{ insert: entries }]));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: [] } } }));
  const ctx = await boot('mineru-settings', configPath, [{ insert: entries }], async (root) => {
    root.provide('profileContext', {
      name: 'mineru-settings', dir, patchPath, installAnchor, cwd: dir, home,
      startedBundles: [], overlays: [], telemetryDisabledEnv: '1',
    });
    await root.plugin(MemoryCredentials);
  }, new URL('../package.json', import.meta.url).href);
  hosts.push(ctx);
  const base = 'http://127.0.0.1:' + ctx.webServer.port + '/plugin/mineru';
  const get = async () => fetch(base + '/config').then((r) => r.json());
  const post = async (path, body) => fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));
  return { get, post };
}

describe('settings card round-trip on the real host (issue #22)', () => {
  it('round-trips extraFormats arrays through update + describe (full-state patches)', async () => {
    const { get, post } = await startHost();

    const initial = await get();
    expect(Array.isArray(initial.value.extraFormats)).toBe(true);
    expect(initial.value.extraFormats).toEqual([]);

    // The card sends the whole UI state as the patch (with a fresh revision).
    const v1 = { ...initial.value, extraFormats: ['docx', 'html', 'latex'] };
    const save1 = await post('/config', { patch: v1, expectedRevision: initial.revision });
    expect(save1.status, JSON.stringify(save1.body)).toBe(200);

    const after1 = await get();
    expect(after1.value.extraFormats).toEqual(['docx', 'html', 'latex']);
    // The checkbox derivation must see all three as checked.
    expect(['docx', 'html', 'latex'].map((f) => after1.value.extraFormats.indexOf(f) >= 0))
      .toEqual([true, true, true]);

    const v2 = { ...initial.value, extraFormats: [] };
    const save2 = await post('/config', { patch: v2, expectedRevision: after1.revision });
    expect(save2.status, JSON.stringify(save2.body)).toBe(200);

    const after2 = await get();
    expect(after2.value.extraFormats).toEqual([]);
    expect(['docx', 'html', 'latex'].map((f) => after2.value.extraFormats.indexOf(f) >= 0))
      .toEqual([false, false, false]);
  });

  it('returns byte-identical values and revisions for consecutive untouched reads', async () => {
    const { get } = await startHost();
    const a = await get();
    const b = await get();
    expect(JSON.stringify(a.value)).toBe(JSON.stringify(b.value));
    expect(a.revision).toBe(b.revision);
  });
});