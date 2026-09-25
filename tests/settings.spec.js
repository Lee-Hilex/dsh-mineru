/**
 * DSH 2.x settings contract.
 *
 * The settings card is derived from the exported `Config` schema and keyed by
 * the profile entry id, and `ctx.settings.register` no longer exists — calling
 * it throws before any tool or skill is registered, which takes the whole
 * plugin down and leaves the card failing with
 * `Failed to execute 'json' on 'Response': Unexpected end of JSON input`.
 * These tests pin both halves of that contract.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@deepseek-ai/dsh-tools', () => ({
  defineTool: (def) => def,
}));

vi.mock('@deepseek-ai/dsh-credentials', () => ({
  credentialRef: (name) => name,
}));

vi.mock('@deepseek-ai/dsh-settings', () => ({
  SettingsConflictError: class SettingsConflictError extends Error {},
}));

import { CONFIG_SCHEMA, DEFAULTS, live, plainConfig, unwrapField } from '../lib/config.js';
import { apply, settingsNamespace } from '../lib/index.js';

/** Minimal cordis context: records registrations, exposes the injected services. */
function makeCtx(services = {}) {
  const tools = [];
  const skills = [];
  const store = new Map(Object.entries(services));
  return {
    // cordis exposes an available service both as `ctx.<name>` and through inject.
    ...services,
    tools: { register: (def) => tools.push(def) },
    skills: { register: (def) => skills.push(def) },
    // cordis runs the effect body immediately and keeps its return value as the disposer.
    effect: (fn) => fn(),
    get: (name) => store.get(name),
    inject: (names, cb) => {
      if (names.every((n) => store.has(n))) {
        cb({ effect: (fn) => fn(), ...Object.fromEntries(names.map((n) => [n, store.get(n)])) });
      }
    },
    registeredTools: () => tools,
    registeredSkills: () => skills,
  };
}

/** A settings service that throws if the removed `register` method is called. */
function makeSettings(descriptor) {
  const updates = [];
  let revision = 0;
  return {
    updates,
    register() {
      throw new TypeError('ctx.settings.register is not a function');
    },
    describe: () => (descriptor === undefined ? [] : [{ ns: 'mineru', revision, value: descriptor, base: {}, user: {}, applies: 'live', secrets: [] }]),
    async update(ns, patch, expected) {
      updates.push({ ns, patch, expected });
      revision += 1;
    },
  };
}

/** Minimal web server capturing the mounted prefix handler. */
function makeWebServer() {
  const routes = [];
  return { host: '127.0.0.1', port: 3000, routes, register: (route) => { routes.push(route); return () => {}; } };
}

/** Drive one request through the mounted handler and decode the JSON body. */
async function call(handler, { method = 'GET', url = '/' } = {}) {
  const state = { status: 0, body: '' };
  const res = {
    headersSent: false,
    writeHead(status) { state.status = status; this.headersSent = true; return this; },
    end(chunk) { if (chunk !== undefined) state.body += chunk; },
    destroy() {},
  };
  const req = { method, url, headers: {}, on(event, cb) { if (event === 'end') cb(); return this; } };
  await handler(req, res);
  return { status: state.status, json: state.body.length > 0 ? JSON.parse(state.body) : undefined };
}

describe('Config schema', () => {
  it('marks every field volatile so the host generates a settings card', () => {
    const fields = Object.entries(CONFIG_SCHEMA.dict ?? {});
    expect(fields.length).toBeGreaterThan(0);
    const plain = fields.filter(([, field]) => field.meta?.volatile !== true).map(([key]) => key);
    expect(plain).toEqual([]);
  });

  it('flags a field even on a schemastery copy without .volatile()', () => {
    // A profile can hoist schemastery 3.18.2, which has no `.volatile()`; the
    // fallback must still write `meta.volatile` instead of throwing.
    const legacy = { extra: (key, value) => ({ meta: { [key]: value } }) };
    expect(live(legacy).meta.volatile).toBe(true);
    expect(live({ volatile: () => ({ meta: { volatile: true } }) }).meta.volatile).toBe(true);
  });
});

describe('live config projection', () => {
  it('unwraps volatile references and passes plain values through', () => {
    expect(unwrapField({ get: () => 'live' })).toBe('live');
    expect(unwrapField('plain')).toBe('plain');
    expect(unwrapField(undefined)).toBe(undefined);
  });

  it('projects a reference-carrying entry config into plain values', () => {
    const config = { mode: { get: () => 'precision' }, timeoutMs: { get: () => 9000 }, plain: 1 };
    expect(plainConfig(config)).toEqual({ mode: 'precision', timeoutMs: 9000, plain: 1 });
  });
});

describe('plugin activation', () => {
  it('activates without ever calling ctx.settings.register', () => {
    const ctx = makeCtx({ credentials: { resolve: async () => undefined, describe: async () => ({}) } });
    expect(() => apply(ctx, { mode: { get: () => 'agent' } })).not.toThrow();
    expect(ctx.registeredTools()).toHaveLength(1); // progressive: the activate bootstrap
    expect(ctx.registeredSkills()).toHaveLength(1);
    expect(ctx.registeredSkills()[0].name).toBe('mineru-tools');
  });

  it('reads registration-time config through the volatile references', () => {
    const ctx = makeCtx({ credentials: { resolve: async () => undefined, describe: async () => ({}) } });
    apply(ctx, { exposeMode: { get: () => 'always' } });
    expect(ctx.registeredTools().map((d) => d.name)).toEqual(['mineru_parse', 'mineru_batch_parse', 'mineru_task']);
  });

  it('resolves the settings namespace from the owning profile entry', () => {
    expect(settingsNamespace({ fiber: { entry: { options: { id: 'mineru-renamed' } } } })).toBe('mineru-renamed');
    expect(settingsNamespace({})).toBe('mineru');
    expect(settingsNamespace({ fiber: { entry: { options: {} } } })).toBe('mineru');
    expect(settingsNamespace(undefined)).toBe('mineru');
  });
});

describe('/plugin/mineru/config', () => {
  /** Mount the routes and return the captured prefix handler. */
  function mount({ settings, config = {} }) {
    const webServer = makeWebServer();
    const ctx = makeCtx({
      settings,
      credentials: { resolve: async () => undefined, describe: async () => ({ configured: false }) },
      webServer,
    });
    apply(ctx, config);
    // The HTTP surface mounts through ctx.inject(['webServer'], …).
    expect(webServer.routes).toHaveLength(1);
    return webServer.routes[0].handler;
  }

  it('returns the descriptor and facts when the card exists', async () => {
    const handler = mount({ settings: makeSettings({ mode: 'auto' }) });
    const result = await call(handler, { url: '/plugin/mineru/config' });
    expect(result.status).toBe(200);
    expect(result.json.ok).toBe(true);
    expect(result.json.value).toEqual({ mode: 'auto' });
    expect(result.json.schemaHints.defaults.mode).toBe(DEFAULTS.mode);
  });

  it('explains a missing card instead of reporting an empty config', async () => {
    const handler = mount({ settings: makeSettings(undefined) });
    const result = await call(handler, { url: '/plugin/mineru/config' });
    expect(result.status).toBe(503);
    expect(result.json.error).toContain('is not registered');
    expect(result.json.hint).toContain('meta.volatile');
  });
});
