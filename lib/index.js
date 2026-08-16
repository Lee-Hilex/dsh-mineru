/**
 * dsh-mineru host plugin: MinerU multimodal document parsing for DeepSeek
 * Harness. Registers the mineru_activate bootstrap (or all tools under
 * exposeMode: always), the mineru-tools skill, the "mineru" settings
 * namespace, credential resolution, and (Web profile) the /plugin/mineru
 * HTTP surface.
 * @module dsh-mineru
 */
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { settingsNamespace } from '@deepseek-ai/dsh-settings';
import { DailyCounter, MineruClient, RateLimiter } from './mineru-client.js';
import { WorkspaceArtifactStore } from './artifacts.js';
import { mountHttp } from './http.js';
import { buildActivateTool, buildAgentTools } from './tools.js';
import { SKILL_CONTENT, SKILL_DESCRIPTION, SKILL_NAME } from './skill.js';
import { CONFIG_SCHEMA, resolveLoadConfig, validateConfig } from './config.js';

/** Cordis plugin name used by loader diagnostics. */
export const name = 'mineru';
/** Required host-plane services. */
export const inject = ['tools', 'skills', 'settings', 'credentials', 'agents'];
/** Entry config schema (validated by the Loader). */
export const Config = CONFIG_SCHEMA;

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} [config] entry config (composition layer)
 */
export function apply(ctx, config) {
  const loadCfg = resolveLoadConfig(config);
  const scope = ctx.settings.register(settingsNamespace('mineru'), CONFIG_SCHEMA, {
    base: config,
    applies: 'live',
    validate: validateConfig,
  });

  /** @type {object} */
  const state = {
    activatedAgents: new WeakSet(),
    artifacts: new WorkspaceArtifactStore({
      artifactRootName: loadCfg.artifactRootName,
      urlTtlSec: loadCfg.artifactUrlTtlSec,
      pluginVersion: '0.1.2',
    }),
    limiters: {
      submit: new RateLimiter(loadCfg.submitRatePerMin),
      poll: new RateLimiter(loadCfg.pollRatePerMin),
      daily: new DailyCounter(loadCfg.dailySubmitLimit),
    },
    /** Set when the Web host mounts; builds preview URLs for tool results. */
    urlBuilder: null,
    agentToolDefs: [],
    getCfg() {
      return scope.get();
    },
    /**
     * Build a MinerU client for one call: resolves the token per operation
     * (credential changes apply to the very next call) and live-updates the
     * shared rate-limit parameters.
     */
    async clientFor(cfg) {
      const ref = credentialRef(cfg.tokenCredential);
      const hit = await ctx.credentials.resolve(ref);
      state.limiters.submit.rate = cfg.submitRatePerMin / 60000;
      state.limiters.submit.capacity = Math.max(1, Math.ceil(cfg.submitRatePerMin / 5));
      state.limiters.poll.rate = cfg.pollRatePerMin / 60000;
      state.limiters.poll.capacity = Math.max(1, Math.ceil(cfg.pollRatePerMin / 5));
      state.limiters.daily.limit = cfg.dailySubmitLimit;
      return new MineruClient({
        baseUrl: cfg.apiBaseUrl,
        token: hit?.value,
        limiters: state.limiters,
        userAgent: cfg.userAgent,
      });
    },
    /** Non-secret facts for health surfaces (Web settings + activate). */
    async collectFacts() {
      const cfg = scope.get();
      const ref = credentialRef(cfg.tokenCredential);
      const info = await ctx.credentials.describe(ref);
      const tokenConfigured = Boolean(info?.configured);
      let api = 'agent';
      if (cfg.mode === 'precision') api = tokenConfigured ? 'precision' : 'precision-missing-token';
      else if (cfg.mode === 'auto') api = tokenConfigured ? 'precision' : 'agent';
      return {
        mode: cfg.mode,
        api,
        tokenConfigured,
        tokenSource: info?.source ?? null,
        tokenWritable: info?.writable ?? false,
        credentialRef: cfg.tokenCredential,
        modelVersion: cfg.modelVersion,
        baseUrl: cfg.apiBaseUrl,
        artifactRootName: cfg.artifactRootName,
        submitRatePerMin: cfg.submitRatePerMin,
        pollRatePerMin: cfg.pollRatePerMin,
        dailySubmitLimit: cfg.dailySubmitLimit,
        exposeMode: loadCfg.exposeMode,
      };
    },
  };
  state.agentToolDefs = buildAgentTools(state);

  ctx.effect(() => {
    ctx.skills.register({
      name: SKILL_NAME,
      description: SKILL_DESCRIPTION,
      content: SKILL_CONTENT,
    });
    if (loadCfg.exposeMode === 'always') {
      for (const def of state.agentToolDefs) ctx.tools.register(def);
    } else {
      ctx.tools.register(buildActivateTool(state));
    }
  });

  // Web profile only: preview URL builder + /plugin/mineru routes.
  ctx.inject(['webServer'], (webCtx) => {
    state.urlBuilder = (cwd, rel) => state.artifacts.capabilityUrl(cwd, rel);
    mountHttp(webCtx, {
      settings: ctx.settings,
      scope,
      credentials: ctx.credentials,
      schema: CONFIG_SCHEMA,
      state,
      agents: ctx.agents,
    });
  });
}
