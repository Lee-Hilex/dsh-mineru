# dsh-mineru — Agent Guide

## Plugin overview

Bundle-style DSH plugin that exposes MinerU document parsing to the model:
PDF/Word/PPT/Excel/HTML/images → structured Markdown. Two API modes, picked
automatically (or forced via the `mode` argument):

- **precision** — official mineru.net API v4, requires a MinerU token (≤200 MB,
  ≤200 pages, batch ≤200 URLs / ≤50 upload links, Zip output with `full.md` +
  JSON + optional docx/html/latex);
- **agent** — token-free Agent lightweight API v1 (≤10 MB, ≤20 pages, single
  file, Markdown-only).

Tools: `mineru_activate` (progressive bootstrap), `mineru_parse`,
`mineru_batch_parse`, `mineru_task`, plus the `mineru-tools` skill. The Web
profile also gets a settings card, tool-result cards, drag-drop intake and an
HTTP surface under `/plugin/mineru/*`.

## Key conventions

- **Bundle form**: `cordis.patch.yml` inserts one plugin row; `package.json`
  carries `dsh.bundle.patch`. No source patches to DSH staging.
- **Host half** (`lib/*.js`): plain ESM JavaScript, no build step. `node --check
  lib/*.js` is the syntax gate; `npm test` runs the vitest suite.
- **Browser half** (`lib/client.js`): single-file bundle registered through
  `window.__ModuleLoader__.load({ id: "dsh-mineru", factory })`. The `id` must
  stay `dsh-mineru` and the bundle must register — the host rejects clients
  that load without registering.
- **Settings**: registered through the settings seam as the plain lowercase
  namespace `'mineru'` — `ctx.settings.register('mineru', CONFIG_SCHEMA, …)`.
  Do not import `settingsNamespace()` (removed in the DSH 0.1.5 line). Config
  resolves schema defaults < composition base < user settings; the MinerU
  token VALUE lives in DSH Credentials under `tokenCredential`
  (default `MINERU_API_TOKEN`), never in settings or composition files.
- **Peers**: `@deepseek-ai/*` host peers are `^0.1.5-rc.1` (semver prerelease
  rules: `0.1.5-rc.x` cannot satisfy `^0.1.0-rc.6`).
- **Commits**: `<type>: <English description>`; docs ride with the code change
  in the same commit. See CONTRIBUTING.md and RELEASE.md (the release SOP is
  mandatory — version, CHANGELOG and bilingual README ship together).
- **Client theming**: emphasis/accents use
  `--dsw-alias-brand-primary-new-colorprimary-new-color` (brand blue in both
  themes). Never use `--dsw-alias-brand-primary` as a background or color — the
  platform binds it to near-black (light) / near-white (dark) *foreground*,
  which produced white-on-white buttons in dark mode (issue #3).
- **Client i18n**: all user-facing strings live in the `zh`/`en` dictionaries
  registered as `dsh-mineru` with `ctx.locale`; components read them through
  `T(key, vars)`. Fall back to the `zh` dict when the locale service is absent.

## File responsibilities

| File | Role |
|------|------|
| `lib/index.js` | Cordis entry: `name = 'mineru'`, `inject = ['tools','skills','settings','credentials','agents']`, `Config` (Schemastery), `apply()` — registers settings namespace, limiters, artifact store, tools/skill, HTTP surface |
| `lib/config.js` | `CONFIG_SCHEMA`, `DEFAULTS`, `validateConfig`, `resolveLoadConfig`, extension/language/model constants |
| `lib/mineru-client.js` | `MineruClient` (official v4 + agent v1, 429 retry, polling, download), `RateLimiter`, `DailyCounter`, `MineruError`, `resolveOptions`, `effectiveModelFor` |
| `lib/tools.js` | `defineTool` definitions: `buildActivateTool`, `buildParseTool`, `buildBatchTool`, `buildTaskTool`, `buildAgentTools` |
| `lib/skill.js` | `mineru-tools` skill content (model-facing usage guide, limits, error-code table) |
| `lib/artifacts.js` | Per-run artifact dirs under `<workspace>/.dsh-mineru/artifacts/`, metadata, HMAC-signed preview URLs, file-name/run-name sanitization |
| `lib/zip.js` | Dependency-free ZIP reader (STORED/DEFLATE, traversal-safe, byte caps) for MinerU result archives |
| `lib/http.js` | Web host surface: `/plugin/mineru/config`, `/credential`, `/test-token`, `/test-agent`, `/upload`, `/artifacts/*` |
| `lib/client.js` | Browser bundle: settings tab (`settings.plugins.tab`), tool-result cards (`tool.call.toolview`), drag-drop/paste bridge, zh/en dictionaries |
| `tests/*.spec.js` | Vitest unit tests (mocked fetch / mocked `@deepseek-ai/*` imports, no live server) |

## Commands

```sh
node --check lib/*.js     # syntax gate for every lib change
npm test                  # vitest run (npm install first)
npm pack --dry-run        # preview the shipped tarball (19 files expected)
```

Release flow: RELEASE.md (version bump → CHANGELOG + bilingual README sync →
`npm pack` → local verification → English commit + tag `vX.Y.Z` + push →
GitHub Release → `npm publish`). npm publishing needs the account's EOTP
web-auth (non-interactive terminals cannot complete it — see RELEASE.md).

## Adding a new tool

1. Define it in `lib/tools.js` with `defineTool({ name, description,
   parameters, output: { schema, render }, timeoutMs, execute })`.
2. Honor `exec.signal` at every await point; map API errors to actionable
   `MineruError` codes (see `mineru-client.js`).
3. Register it in `buildAgentTools(state)` (or adjust the activation flow in
   `lib/index.js`); update the `mineru-tools` skill content in `lib/skill.js`
   and the tool tables in `README.md` / `README.zh.md` in the same commit.
4. Add a unit test under `tests/` for the pure logic (option resolution,
   error mapping, output rendering).

## MinerU API gotchas

- HTML files only work in precision mode and are force-pinned to
  `MinerU-HTML`; agent mode rejects `.html/.htm/.doc/.ppt/.xls`.
- `pageRanges` (precision) accepts comma-separated ranges and negative
  indexes like `"2--2"`; agent mode uses a single `pageRange` like `"1-10"`.
- Rate limits are enforced client-side too: submissions 50/min shared across
  submit endpoints, queries 1000/min, 5000 files/day (HTML ≤100/day);
  HTTP 429 is retried with `Retry-After` backoff.
- MinerU cannot fetch walled URLs (github/aws S3 etc.); local files are
  preferred — upload paths, never inline bytes, and reuse the workspace
  artifact store.
- Batch results may contain per-file failures; surface them per row instead of
  failing the whole call.

## Known traps

- `settingsNamespace()` no longer exists in `@deepseek-ai/dsh-settings` ≥0.1.5;
  use the plain `'mineru'` string.
- The client bundle must start by registering with
  `window.__ModuleLoader__.load` — a plain ESM bundle silently breaks the Web
  profile.
- `--dsw-alias-brand-primary` is a foreground token (near-black/near-white),
  not an accent — see the theming convention above.
- Peer ranges must stay `^0.1.5-rc.1` for the six `@deepseek-ai/dsh-*` peers.
