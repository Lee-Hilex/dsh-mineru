/**
 * dsh-mineru configuration schema and defaults.
 *
 * The config document carries only references — the MinerU token VALUE lives in
 * DSH Credentials under the `tokenCredential` reference name (default
 * MINERU_API_TOKEN), never in settings or composition files.
 *
 * Resolution layers: schema defaults < composition base (the bundle row's
 * config) < the profile entry patch written by the Web Settings card. DSH 2.x
 * derives that card from this schema, so every field is marked live (see
 * {@link live}) and arrives in `apply(ctx, config)` as a volatile reference
 * rather than a plain value — read it through {@link plainConfig}.
 * @module dsh-mineru/config
 */
import z from '@deepseek-ai/schemastery';

/**
 * Mark one field live-editable.
 *
 * DSH 2.x derives a plugin's settings card from its exported `Config` and only
 * offers the fields carrying `meta.volatile`; a schema without them has no card
 * at all. `.volatile()` exists in schemastery >= 3.18.4 only, and a profile can
 * hoist an older copy (3.18.2 still satisfies `^3.18.0`) above the
 * installation's one, so an unguarded call fails activation with
 * `TypeError: ...volatile is not a function`. `.extra('volatile', true)` writes
 * the same flag on every version, so the card appears either way; only hot-edit
 * needs the newer copy.
 * @template T
 * @param {T} field one schemastery field
 * @returns {T} the field, flagged volatile when the copy supports it
 */
export function live(field) {
  if (typeof field?.volatile === 'function') return field.volatile();
  if (typeof field?.extra === 'function') return field.extra('volatile', true);
  return field;
}

/**
 * Unwrap one live configuration reference.
 *
 * A `meta.volatile` field resolves to a cosmokit volatile reference; reading it
 * through `get()` is what makes a settings write visible to the next call.
 * Plain values pass through unchanged.
 * @param {unknown} value a reference or a plain value
 * @returns {unknown} the current value
 */
export function unwrapField(value) {
  return value !== null && typeof value === 'object' && typeof value.get === 'function' ? value.get() : value;
}

/**
 * Project the entry config into plain values.
 * @param {object} [config] entry config handed to `apply` (volatile fields are references)
 * @returns {object} a plain, detached configuration object
 */
export function plainConfig(config) {
  const out = {};
  for (const [key, value] of Object.entries(config ?? {})) out[key] = unwrapField(value);
  return out;
}

/** Supported MinerU document languages (language packs from the API docs). */
export const LANGUAGE_VALUES = Object.freeze([
  'ch', 'ch_server', 'en', 'japan', 'korean', 'chinese_cht',
  'ta', 'te', 'ka', 'el', 'th',
  'latin', 'arabic', 'cyrillic', 'east_slavic', 'devanagari',
]);

/** Precision-API model versions. */
export const MODEL_VERSION_VALUES = Object.freeze(['pipeline', 'vlm', 'MinerU-HTML']);

/** API-mode selection. 'auto' resolves token present -> precision, absent -> agent. */
export const MODE_VALUES = Object.freeze(['auto', 'precision', 'agent']);

/** Extra export formats the precision API can add to the result zip. */
export const EXTRA_FORMAT_VALUES = Object.freeze(['docx', 'html', 'latex']);

/** Model-facing exposure strategy. */
export const EXPOSE_MODE_VALUES = Object.freeze(['progressive', 'always']);

/** File extensions MinerU accepts (precision). */
export const SUPPORTED_EXTENSIONS = Object.freeze([
  '.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx',
  '.png', '.jpg', '.jpeg', '.jp2', '.webp', '.gif', '.bmp', '.html', '.htm',
]);

/** Extensions the Agent lightweight API rejects (HTML is precision-only). */
export const AGENT_UNSUPPORTED_EXTENSIONS = Object.freeze(['.html', '.htm', '.doc', '.ppt', '.xls']);

export const DEFAULTS = Object.freeze({
  apiBaseUrl: 'https://mineru.net',
  /** DSH Credential reference that holds the MinerU token. Never a secret itself. */
  tokenCredential: 'MINERU_API_TOKEN',
  /** auto | precision | agent */
  mode: 'auto',
  /** Precision model: pipeline | vlm | MinerU-HTML. HTML sources force MinerU-HTML. */
  modelVersion: 'vlm',
  language: 'ch',
  enableTable: true,
  enableFormula: true,
  isOcr: false,
  /** Precision-only extra exports: docx | html | latex. */
  extraFormats: [],
  /** progressive: bootstrap + per-agent activation; always: register everything globally. */
  exposeMode: 'progressive',
  /** Artifact root directory name under each session workspace. */
  artifactRootName: '.dsh-mineru',
  /** Base poll interval for task result queries (ms). */
  pollIntervalMs: 3000,
  /** Random poll jitter added per query (ms). */
  pollJitterMs: 500,
  /** Whole-operation deadline (ms). */
  timeoutMs: 600000,
  /** Local file byte cap. 0 = per-mode API limits (200 MB precision / 10 MB agent). */
  maxFileBytes: 0,
  /** Markdown preview bytes returned inline with the tool result. */
  inlineMarkdownBytes: 12000,
  /** Signed artifact URL lifetime (seconds). */
  artifactUrlTtlSec: 86400,
  /** Client-side submission rate cap (official limit: 50 files/min). */
  submitRatePerMin: 40,
  /** Client-side result-query rate cap (official limit: 1000/min). */
  pollRatePerMin: 900,
  /** Daily submission cap reported before the API rejects (official: 5000 files/day). */
  dailySubmitLimit: 5000,
  userAgent: 'dsh-mineru (+DeepSeek-Harness)',
});

export const CONFIG_SCHEMA = z.object({
  apiBaseUrl: live(z.string().role('text')
    .default(DEFAULTS.apiBaseUrl)
    .description('MinerU API base URL (https://mineru.net).')),
  tokenCredential: live(z.string().role('text')
    .default(DEFAULTS.tokenCredential)
    .description('DSH Credential reference name holding the MinerU token.')),
  mode: live(z.union([z.const('auto'), z.const('precision'), z.const('agent')])
    .default(DEFAULTS.mode)
    .description('API mode: auto (token present -> precision, else agent), precision, or agent.')),
  modelVersion: live(z.union([z.const('pipeline'), z.const('vlm'), z.const('MinerU-HTML')])
    .default(DEFAULTS.modelVersion)
    .description('Precision-API model version (pipeline | vlm | MinerU-HTML).')),
  language: live(z.string().role('text')
    .default(DEFAULTS.language)
    .description('Document language pack, e.g. ch, en, latin (see README table).')),
  enableTable: live(z.boolean().default(DEFAULTS.enableTable)
    .description('Enable table recognition.')),
  enableFormula: live(z.boolean().default(DEFAULTS.enableFormula)
    .description('Enable formula recognition.')),
  isOcr: live(z.boolean().default(DEFAULTS.isOcr)
    .description('Force OCR for scanned content.')),
  extraFormats: live(z.array(z.union([z.const('docx'), z.const('html'), z.const('latex')]))
    .default(DEFAULTS.extraFormats)
    .description('Precision-only extra export formats added to the result zip.')),
  exposeMode: live(z.union([z.const('progressive'), z.const('always')])
    .default(DEFAULTS.exposeMode)
    .description('progressive: mineru_activate bootstrap + skill-based activation; always: register all tools globally.')),
  artifactRootName: live(z.string().role('text')
    .default(DEFAULTS.artifactRootName)
    .description('Artifact root directory name inside each session workspace.')),
  pollIntervalMs: live(z.number().default(DEFAULTS.pollIntervalMs)
    .description('Task-result poll interval (ms).')),
  pollJitterMs: live(z.number().default(DEFAULTS.pollJitterMs)
    .description('Per-query poll jitter (ms).')),
  timeoutMs: live(z.number().default(DEFAULTS.timeoutMs)
    .description('Whole-operation deadline (ms).')),
  maxFileBytes: live(z.number().default(DEFAULTS.maxFileBytes)
    .description('Local file byte cap; 0 = per-mode API limits (200 MB / 10 MB).')),
  inlineMarkdownBytes: live(z.number().default(DEFAULTS.inlineMarkdownBytes)
    .description('Markdown preview bytes returned inline with the tool result.')),
  artifactUrlTtlSec: live(z.number().default(DEFAULTS.artifactUrlTtlSec)
    .description('Signed artifact preview URL lifetime (seconds).')),
  submitRatePerMin: live(z.number().default(DEFAULTS.submitRatePerMin)
    .description('Submission rate cap per minute (official limit: 50/min).')),
  pollRatePerMin: live(z.number().default(DEFAULTS.pollRatePerMin)
    .description('Result-query rate cap per minute (official limit: 1000/min).')),
  dailySubmitLimit: live(z.number().default(DEFAULTS.dailySubmitLimit)
    .description('Daily submission cap reported before the API rejects (official: 5000/day).')),
  userAgent: live(z.string().role('text').default(DEFAULTS.userAgent)
    .description('User-Agent header sent to MinerU.')),
});

/**
 * Validate one resolved config section (schema has already run).
 * Cross-field and range constraints the schema cannot express.
 * @param {object} value resolved section
 * @throws {Error} when the section is unusable
 */
export function validateConfig(value) {
  const err = (msg) => { throw new Error('dsh-mineru config: ' + msg); };
  if (!MODE_VALUES.includes(value.mode)) err('mode must be one of ' + MODE_VALUES.join('|'));
  if (!MODEL_VERSION_VALUES.includes(value.modelVersion)) err('modelVersion must be one of ' + MODEL_VERSION_VALUES.join('|'));
  if (!LANGUAGE_VALUES.includes(value.language)) err('language must be one of ' + LANGUAGE_VALUES.join('|'));
  if (!EXPOSE_MODE_VALUES.includes(value.exposeMode)) err('exposeMode must be one of ' + EXPOSE_MODE_VALUES.join('|'));
  for (const f of value.extraFormats) {
    if (!EXTRA_FORMAT_VALUES.includes(f)) err('extraFormats may only contain ' + EXTRA_FORMAT_VALUES.join('|'));
  }
  if (!/^https?:\/\//i.test(value.apiBaseUrl ?? '')) err('apiBaseUrl must be an http(s) URL');
  const integerIn = (name, v, min, max) => {
    if (!Number.isInteger(v) || v < min || v > max) err(name + ' must be an integer in [' + min + ', ' + max + ']');
  };
  integerIn('pollIntervalMs', value.pollIntervalMs, 500, 60000);
  integerIn('pollJitterMs', value.pollJitterMs, 0, 10000);
  integerIn('timeoutMs', value.timeoutMs, 10000, 3600000);
  integerIn('maxFileBytes', value.maxFileBytes, 0, 512 * 1024 * 1024);
  integerIn('inlineMarkdownBytes', value.inlineMarkdownBytes, 256, 1024 * 1024);
  integerIn('artifactUrlTtlSec', value.artifactUrlTtlSec, 60, 30 * 24 * 3600);
  integerIn('submitRatePerMin', value.submitRatePerMin, 1, 60);
  integerIn('pollRatePerMin', value.pollRatePerMin, 10, 1000);
  integerIn('dailySubmitLimit', value.dailySubmitLimit, 1, 100000);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.tokenCredential ?? '')) err('tokenCredential must be a POSIX-shell-shaped reference name');
  const root = value.artifactRootName ?? '';
  if (!root || root.includes('/') || root.includes('\\') || root === '.' || root === '..') err('artifactRootName must be a single directory name');
  return value;
}

/** Merged defaults + overrides (used at plugin load for exposeMode, which is composition-scoped). */
export function resolveLoadConfig(config) {
  const value = { ...DEFAULTS, ...(config ?? {}) };
  validateConfig(value);
  return value;
}