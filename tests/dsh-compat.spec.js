/** Real DSH runtime contracts; keep host packages unmocked in this file. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { boot, evaluatePluginCompatibility } from '@deepseek-ai/dsh-app-boot';
import { CredentialProvider } from '@deepseek-ai/dsh-credentials';
import { createScope } from '@deepseek-ai/dsh-scope';
import { DEFAULTS } from '../lib/config.js';
import { makeFakeCloud } from './helpers/fake-cloud.js';
import { buildPdf } from './helpers/zip.js';

const require = createRequire(import.meta.url);
const packageDir = process.env.DSH_MINERU_TEST_PACKAGE;
const manifest = packageDir ? require(join(packageDir, 'package.json')) : require('../package.json');
const pluginPath = packageDir ? pathToFileURL(join(packageDir, 'lib/index.js')).href : new URL('../lib/index.js', import.meta.url).href;
const installAnchor = fileURLToPath(new URL('../package.json', import.meta.url));

/** Test provider implements the real credential seam without reading user secrets. */
class MemoryCredentials extends CredentialProvider {
  values = new Map();
  async resolve(ref) {
    const value = this.values.get(ref);
    return value === undefined ? undefined : { value, source: 'test' };
  }
  async describe(ref) {
    return { configured: this.values.has(ref), writable: true, source: 'test' };
  }
  async set(ref, value) { this.values.set(ref, value); }
  async unset(ref) { this.values.delete(ref); }
}

const hosts = [];
const dirs = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const ctx of hosts.splice(0)) await ctx.fiber.dispose();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function startHost(config = {}, entryId = 'mineru-renamed') {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-mineru-compat-'));
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
    { id: entryId, name: pluginPath, config },
  ];
  const patches = [{ insert: entries }];
  const home = join(dir, 'home');
  await mkdir(home);
  await writeFile(configPath, '[]\n');
  await writeFile(patchPath, JSON.stringify(patches));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ private: true, dsh: { profile: { bundles: [] } } }));
  const ctx = await boot('mineru-compat', configPath, patches, async (root) => {
    root.provide('profileContext', {
      name: 'mineru-compat', dir, patchPath, installAnchor, cwd: dir, home,
      startedBundles: [], overlays: [], telemetryDisabledEnv: '1',
    });
    await root.plugin(MemoryCredentials);
  }, new URL('../package.json', import.meta.url).href);
  hosts.push(ctx);
  expect(ctx.tools, 'tools service activated').toBeDefined();
  const entry = [...ctx.loader.entries()].find((row) => row.options.id === entryId);
  expect(entry?.fiber?.state, 'MinerU entry activated').toBe(2);
  const base = 'http://127.0.0.1:' + ctx.webServer.port + '/plugin/mineru';
  const request = async (path, body) => {
    const response = await fetch(base + path, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { ctx, dir, entry, request };
}

function scopedAgent(ctx, cwd) {
  const agent = { session: { header: { cwd } } };
  const scope = createScope(ctx, agent);
  agent.ctx = scope.ctx;
  return { agent, scope };
}

describe('DSH 0.2.0-rc.2 compatibility', () => {
  it('passes the actual compatibility gate without exemptions and retains the legacy range', () => {
    expect(evaluatePluginCompatibility(manifest, {}, '0.2.0-rc.2')).toBeUndefined();
    expect(evaluatePluginCompatibility(manifest, {}, '0.1.5-rc.3')).toBeUndefined();
    expect(evaluatePluginCompatibility(manifest, {}, '0.3.0-rc.1')).toBeDefined();
  });

  it('activates through the Loader and isolates progressive tools per agent', async () => {
    const { ctx, dir, entry } = await startHost();
    expect((await ctx.skills.list()).map((skill) => skill.name)).toContain('mineru-tools');
    expect(ctx.tools.schemas().map((tool) => tool.name)).toEqual(['mineru_activate']);
    const { agent, scope } = scopedAgent(entry.fiber.ctx, dir);
    const result = await ctx.tools.execute({
      callId: 'activate', name: 'mineru_activate', arguments: {}, agent, signal: new AbortController().signal,
    });
    expect(result.isError, JSON.stringify(result)).toBe(false);
    expect(result.value.tools).toEqual(['mineru_parse', 'mineru_batch_parse', 'mineru_task']);
    expect(ctx.tools.schemas(agent).map((tool) => tool.name)).toEqual(result.value.tools);
    expect(ctx.tools.schemas().map((tool) => tool.name)).toEqual(['mineru_activate']);
    await scope.dispose();
    expect(ctx.tools.schemas(agent).map((tool) => tool.name)).toEqual(['mineru_activate']);
  });

  it('persists live settings under the entry id and fences stale writes', async () => {
    const { ctx, entry, dir, request } = await startHost();
    expect(ctx.settings.register).toBeUndefined();
    const initial = await request('/config');
    expect(initial.status).toBe(200);
    expect(initial.body.value.mode).toBe('auto');
    const revision = initial.body.revision;
    const saved = await request('/config', { patch: { mode: 'agent', language: 'en' }, expectedRevision: revision });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    const changed = await request('/config');
    expect(changed.body.value.mode).toBe('agent');
    expect(changed.body.facts.mode).toBe('agent');
    expect(entry.fiber.config.mode.get()).toBe('agent');
    expect(await readFile(join(dir, 'cordis.patch.yml'), 'utf8')).toContain('language: en');
    const stale = await request('/config', { patch: { language: 'ch' }, expectedRevision: revision });
    expect(stale.status).toBe(409);
    expect(stale.body.currentRevision).toBe(changed.body.revision);
  });

  it('resolves credential changes on the next call without exposing the token', async () => {
    const { request } = await startHost();
    const secret = 'compatibility-test-token';
    const saved = await request('/credential', { value: secret });
    expect(saved.status).toBe(200);
    const config = await request('/config');
    expect(config.body.facts.tokenConfigured).toBe(true);
    expect(config.body.facts.api).toBe('precision');
    expect(JSON.stringify(config.body)).not.toContain(secret);
    expect((await request('/credential', { clear: true })).status).toBe(200);
    expect((await request('/config')).body.facts.api).toBe('agent');
  });

  it.each([
    { submitRatePerMin: 0 }, { timeoutMs: -1 }, { artifactRootName: '../outside' },
    { tokenCredential: 'INVALID-NAME' }, { language: 'invalid-language' },
  ])('rejects invalid live settings before persisting %j', async (patch) => {
    const { request } = await startHost();
    const initial = await request('/config');
    const result = await request('/config', { patch, expectedRevision: initial.body.revision });
    expect(result.status, JSON.stringify(result.body)).toBe(400);
    const current = await request('/config');
    expect(current.body.value).toEqual(initial.body.value);
    expect(current.body.revision).toBe(initial.body.revision);
  });

  it('refuses writes to an unrelated credential reference', async () => {
    const { ctx, request } = await startHost();
    await ctx.credentials.set('OTHER_API_KEY', 'keep-this-value');
    const result = await request('/credential', { ref: 'OTHER_API_KEY', clear: true });
    expect(result.status).toBe(400);
    expect((await ctx.credentials.resolve('OTHER_API_KEY')).value).toBe('keep-this-value');
  });

  it('also rejects invalid values through the native settings service', async () => {
    const { ctx } = await startHost();
    for (const patch of [{ submitRatePerMin: 0 }, { timeoutMs: 10000.5 }, { artifactRootName: '..' }, { language: 'invalid' }]) {
      await expect(ctx.settings.update('mineru-renamed', patch)).rejects.toThrow();
    }
    expect(ctx.settings.describe()[0].revision).toBe(0);
  });

  it('returns 400 for malformed write bodies', async () => {
    const { request } = await startHost();
    expect((await request('/config', { patch: [] })).status).toBe(400);
    expect((await request('/credential', null)).status).toBe(400);
    expect((await request('/credential', [])).status).toBe(400);
  });

  it('executes parsing and validates its output through the real tool runtime', async () => {
    const { ctx, dir, entry } = await startHost({ exposeMode: 'always' });
    await ctx.credentials.set(DEFAULTS.tokenCredential, 'test-token');
    await writeFile(join(dir, 'sample.pdf'), buildPdf({ pages: 2 }));
    const cloud = makeFakeCloud({ totalPages: 2, pollUntilDone: 1 });
    vi.stubGlobal('fetch', cloud.fetch);
    const { agent, scope } = scopedAgent(entry.fiber.ctx, dir);
    const result = await ctx.tools.execute({
      callId: 'parse', name: 'mineru_parse', arguments: { source: 'sample.pdf', anchor: true },
      agent, signal: new AbortController().signal,
    });
    expect(result.isError, JSON.stringify(result)).toBe(false);
    expect(result.value.state).toBe('done');
    expect(result.value.api).toBe('precision');
    expect(await readFile(join(result.value.runDir, 'document.md'), 'utf8')).toContain('<!-- p2 b1 -->');
    expect(cloud.calls.submit).toHaveLength(1);
    expect(cloud.calls.upload).toHaveLength(1);
    await scope.dispose();
  });
});
