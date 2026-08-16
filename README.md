# dsh-mineru

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.1.7-blue)](https://github.com/Lee-Hilex/dsh-mineru/releases)
[![dsh](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.6%2B-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness)
[![MinerU](https://img.shields.io/badge/MinerU-API-4d6bfe)](https://mineru.net/apiManage/docs)

> Repository: <https://github.com/Lee-Hilex/dsh-mineru> · npm: [`dsh-mineru`](https://www.npmjs.com/package/dsh-mineru) · [Changelog](CHANGELOG.md)

English | [简体中文](README.zh.md)

**dsh-mineru** is a **MinerU-powered multimodal document parsing plugin** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh): turn PDF, Word, PPT, Excel, HTML, and images into **structured Markdown**. Configure a MinerU token to use the 🎯 Precision API, or leave it blank and use the ⚡ Agent API (tokenless, IP rate-limited).

## Contents

- [Overview](#overview) · [Quick start](#quick-start) · [Two API modes](#two-api-modes) · [Tools](#tools) · [Results & artifacts](#results--artifacts) · [Configuration](#configuration) · [Usage tips](#usage-tips) · [Web UI](#web-ui) · [Rate limits & reliability](#rate-limits--reliability) · [Error code reference](#error-code-reference) · [Security model](#security-model) · [FAQ](#faq) · [Development & publishing](#development--publishing) · [Contributing](#contributing) · [License](#license)

## Overview

### What is this?

dsh-mineru plugs [MinerU](https://mineru.net) (OpenDataLab's high-precision document parsing engine) into the DeepSeek Harness agent ecosystem, letting **text-only models "read" documents**: the model receives structured Markdown (tables, formulas, and images preserved) instead of binary files it cannot open.

Typical use cases:

- Read papers / contracts / reports: parse a PDF, then ask the agent to summarize or extract data;
- Batch-processing documents: parse dozens of files in one call, each producing Markdown;
- OCR for images / screenshots: scanned pages and web screenshots become searchable text;
- Formulas & tables: math formulas in papers and Excel tables survive with full structure.

### Supported file formats

| Format | Precision API (token required) | Agent API (tokenless) |
| --- | --- | --- |
| PDF | ✅ | ✅ |
| Word (`.doc` / `.docx`) | ✅ | ✅ (`.docx` only) |
| PPT (`.ppt` / `.pptx`) | ✅ | ✅ (`.pptx` only) |
| Excel (`.xls` / `.xlsx`) | ✅ | ✅ (`.xlsx` only) |
| HTML (`.html` / `.htm`) | ✅ (forces MinerU-HTML model) | ❌ |
| Images (`.png` `.jpg` `.jpeg` `.jp2` `.webp` `.gif` `.bmp`) | ✅ | ✅ |

> Note: the Agent API does not support `.doc` / `.ppt` / `.xls` (legacy Office formats) or HTML — use the Precision API (token required) for those.

### Highlights

- **Dual API modes, auto-selected** — chooses Precision or Agent parsing based on whether a token is configured; can be overridden per call;
- **Progressive tool exposure** — only the tiny `mineru_activate` bootstrap is visible until the agent activates the full toolset, saving context;
- **Drag-and-drop uploads** — drop a file into the chat; its path lands in the composer draft so text-only models can process documents;
- **Auto-chunked batch parsing** — submit hundreds of files/URLs at once; batching respects official limits automatically;
- **Rate-limit aware** — built-in token buckets, daily caps, 429 backoff, and actionable messages for every error code;
- **Artifact-backed results** — parsed output lands in the workspace as files with signed preview links in the Web UI.

## Quick start

### Step 1: Install

Prerequisites: DeepSeek Harness `0.1.0-rc.6` (or a compatible `0.1.x`) with the `dsh` CLI available.

```bash
# Web profile
dsh plugin --profile web add dsh-mineru

# Headless profile
dsh plugin --profile headless add dsh-mineru
```

Restart a running Web profile, then open **Settings → Plugins → MinerU 解析**.

For a local build, install from the packed tarball (see [Development & publishing](#development--publishing)):

```bash
dsh plugin --profile web add <path>/dsh-mineru-0.1.7.tgz
```

### Step 2: Configure (optional)

**No token needed to get started** — the plugin automatically falls back to the tokenless Agent API. Add a token to unlock the full feature set (Precision API, batch parsing, HTML, more formats):

- **Web UI**: Settings → Plugins → **MinerU 解析** → paste the token into the write-only field (blank keeps the existing value);
- **Headless / CLI**: put `MINERU_API_TOKEN: <token>` in `$DSH_HOME/.credentials.yaml`, or export the `MINERU_API_TOKEN` environment variable.

The token is resolved once per operation — **rotations take effect on the very next call without a restart**. Get a token by registering at <https://mineru.net> (API management page).

### Step 3: Use it

**Web UI** (drag-and-drop friendly):

1. **Drag** a PDF/Word/image into the chat — the file is saved to the session workspace and its path is filled into the composer draft (never auto-sent);
2. Add your request, e.g. "Parse this PDF to Markdown and summarize the key points";
3. Send. The agent activates the toolset and calls `mineru_parse`; results come back as files you can preview.

**URL parsing**: just tell the agent "parse this document: https://example.com/paper.pdf".

**Headless / CLI**: the agent calls the tools automatically when it sees a workspace path or URL; you can also type `/mineru-tools` in a conversation to load the usage skill.

## Two API modes

| | 🎯 Precision API (token required) | ⚡ Agent API (tokenless) |
| --- | --- | --- |
| Endpoints | `/api/v4/extract/task`, `/api/v4/file-urls/batch`, `/api/v4/extract/task/batch` | `/api/v1/agent/parse/url`, `/api/v1/agent/parse/file` |
| Models | `pipeline` / `vlm` (default) / `MinerU-HTML` | fixed lightweight pipeline |
| Size limit | ≤ 200 MB | ≤ 10 MB |
| Page limit | ≤ 200 pages | ≤ 20 pages |
| Batch parsing | ✅ (URLs ≤ 200/batch, local uploads ≤ 50/batch, auto-chunked) | ❌ single file only |
| Output | Zip: `full.md` + `content_list.json` + `layout.json` + images (+ optional docx/html/latex) | Markdown only |
| Best for | Long docs, scans, formulas/tables, batch jobs, HTML | Quick reads, small files, temporary use |

**Mode selection** (`mode` parameter or config):

- `auto` (default) — Precision when a token is configured, Agent otherwise;
- `precision` — force Precision; errors loudly when no token is configured;
- `agent` — force Agent.

To see which API the current session is actually using: call `mineru_activate` once — the `api` field in its result tells you (`precision` or `agent`).

## Tools

By default the toolset is **progressively exposed**: only the `mineru_activate` bootstrap is registered at first. One call unlocks the other three tools, and `mineru_activate` then hides itself for that session.

### `mineru_activate` — activation bootstrap

| Item | Description |
| --- | --- |
| Purpose | Unlocks `mineru_parse` / `mineru_batch_parse` / `mineru_task` and loads the `mineru-tools` skill |
| Parameters | none |
| Returns | A status summary: effective API mode, token configured or not, per-API limits |

### `mineru_parse` — parse a single document

Parses a **workspace file path** or **http(s) URL** into structured Markdown.

| Parameter | Required | Description |
| --- | --- | --- |
| `source` | ✅ | Workspace file path, or full http(s) URL |
| `mode` | | `auto` (default) / `precision` / `agent` |
| `modelVersion` | | Precision model: `pipeline` / `vlm` (default, recommended) / `MinerU-HTML` (forced automatically for HTML sources) |
| `language` | | Document language pack, default `ch` — see [Configuration](#configuration) |
| `enableTable` | | Table recognition, default `true` |
| `enableFormula` | | Formula recognition, default `true` |
| `isOcr` | | Force OCR for scans, default `false` |
| `pageRanges` | | Precision page ranges, comma-separated: `"2,4-6"`; negative pages supported: `"2--2"` (2nd from last) |
| `pageRange` | | Agent page range, `from-to` or single page: `"1-10"` |
| `extraFormats` | | Extra export formats (Precision only): `docx` / `html` / `latex` |
| `dataId` | | Business data ID (optional, ≤ 128 chars) |
| `timeoutMs` | | Whole-operation timeout incl. polling; defaults to plugin config (10 min) |
| `output` | | Result directory base name; defaults to the source file name |

**Result highlights**: `ok`, the `api`/`modelVersion` used, `taskId`, duration, `runDir`, a truncated Markdown preview, and the artifact list (with signed preview links on Web).

### `mineru_batch_parse` — batch parsing (Precision only)

Parses many documents in one call; **local paths and URLs can be mixed**, submissions are auto-chunked within official limits, and per-item success/failure is reported.

| Parameter | Required | Description |
| --- | --- | --- |
| `sources` | ✅ | Mixed list of file paths / URLs |
| `outputPrefix` | | Result directory base name, default `batch` |
| `dataIdPrefix` | | Business data ID prefix; a sequence number is appended per item (optional) |
| others | | Same shared options as `mineru_parse` (except `mode` — this tool is Precision-only) |

**Chunking rules**: local files ≤ 50 per batch, URLs ≤ 200 per batch, ≤ 1000 total per call; exceeding these errors with a hint to split the call.

**Result highlights**: success/failure counts, `batchId`s, per-item results (each success includes its `full.md` directory), and error messages for failures.

### `mineru_task` — task query & result collection

**A timed-out parse is never lost**: use the `taskId` + `api` returned by `mineru_parse` to query progress and collect results later — no resubmission needed.

| Parameter | Required | Description |
| --- | --- | --- |
| `taskId` | ✅ | The task_id returned when the task was submitted |
| `api` | ✅ | Which API owns the task: `precision` or `agent` |
| `wait` | | Poll until the task finishes, default `false` (query once) |
| `collect` | | Download the result into an Artifact when done, default `true` |
| `output` | | Result directory base name, default `task` |
| `timeoutMs` | | Timeout for `wait` mode |

**Typical scenario**: `mineru_parse` timed out on a large PDF → tell the agent "collect the result for taskId=xxx with mineru_task".

### `mineru-tools` skill

The plugin ships a skill of the same name. Type `/mineru-tools` in a conversation or ask the agent to load it via the `skill` tool: it contains the full agent-facing manual — tool list, dual-API comparison, usage notes, and official limits.

## Results & artifacts

All results land in **`<workspace>/.dsh-mineru/artifacts/<run>/`** (`<workspace>` is the session workspace, `<run>` a fresh directory per parse):

```
.dsh-mineru/artifacts/<run>/
├── full.md                  # Structured Markdown (both modes)
├── run.json                 # Run metadata (source, API, model, duration, …)
├── *_content_list.json      # Structured content list (Precision only)
├── layout.json              # Layout data (Precision only)
├── *_model.json             # Raw model output (Precision only)
├── *_origin.pdf             # Server-side original file (Precision only)
├── images/                  # Embedded images (Precision only)
└── result.zip               # Raw server result package (Precision only)
```

- Tool results carry a **bounded Markdown preview** (first 12 KB by default); read the full text from `full.md` with the `read` tool;
- **Web UI**: artifacts get HMAC-signed preview URLs (24 h lifetime by default) — click to view/download; tool-result cards open files directly;
- **Headless**: use the absolute paths returned by the tool.

Batch parses keep each document in its own subdirectory: `<run>/<file-name>/full.md`.

## Configuration

Configuration resolves in three layers, later wins: **schema defaults ← composition layer (the `mineru` row config in a profile patch) ← user settings (written through the Web Settings card)**.

```yaml
# Composition-layer example (cordis.patch.yml or a profile patch)
- id: mineru
  config:
    mode: auto               # auto | precision | agent
    modelVersion: vlm        # pipeline | vlm | MinerU-HTML
    language: ch             # document language pack
    enableTable: true        # table recognition
    enableFormula: true      # formula recognition
    isOcr: false             # force OCR
    extraFormats: []         # docx | html | latex (Precision only)
    exposeMode: progressive  # progressive: bootstrap activation; always: register everything globally
    timeoutMs: 600000        # whole-operation timeout (ms)
    pollIntervalMs: 3000     # result poll interval (ms)
    inlineMarkdownBytes: 12000  # inline preview bytes in tool results
    submitRatePerMin: 40     # submission rate cap (per minute)
    pollRatePerMin: 900      # query rate cap (per minute)
    dailySubmitLimit: 5000   # daily submission cap
    artifactRootName: .dsh-mineru  # artifact root directory name
```

### Full option reference

| Option | Default | Description |
| --- | --- | --- |
| `mode` | `auto` | API mode: `auto` (by token presence) / `precision` / `agent` |
| `modelVersion` | `vlm` | Precision model: `pipeline` / `vlm` / `MinerU-HTML` (forced for HTML sources) |
| `language` | `ch` | Document language pack (see below) |
| `enableTable` | `true` | Table recognition |
| `enableFormula` | `true` | Formula recognition |
| `isOcr` | `false` | Force OCR for scans |
| `extraFormats` | `[]` | Extra export formats (Precision only): `docx` / `html` / `latex` |
| `exposeMode` | `progressive` | `progressive`: bootstrap + per-agent activation; `always`: register all tools globally |
| `timeoutMs` | `600000` | Whole-operation timeout incl. polling; range 10 s – 1 h |
| `pollIntervalMs` | `3000` | Result poll interval; range 500 – 60000 ms |
| `pollJitterMs` | `500` | Per-query poll jitter so requests do not line up |
| `maxFileBytes` | `0` | Local file byte cap; `0` = per-mode API limits (200 MB / 10 MB) |
| `inlineMarkdownBytes` | `12000` | Markdown preview bytes returned inline with tool results |
| `artifactUrlTtlSec` | `86400` | Signed preview URL lifetime (s); range 60 s – 30 days |
| `submitRatePerMin` | `40` | Submission rate cap (official: 50/min) |
| `pollRatePerMin` | `900` | Result-query rate cap (official: 1000/min) |
| `dailySubmitLimit` | `5000` | Daily submission cap (official: 5000/day) |
| `tokenCredential` | `MINERU_API_TOKEN` | DSH credential reference name (a reference, never the secret) |
| `apiBaseUrl` | `https://mineru.net` | MinerU API base URL |
| `artifactRootName` | `.dsh-mineru` | Artifact root directory name (single segment) |
| `userAgent` | `dsh-mineru/<version>` | Request User-Agent |

### Token (DSH Credentials)

The configuration stores only the **credential reference name** (default `MINERU_API_TOKEN`); the token value lives in the credentials layer. Any of three ways:

1. **Web Settings card**: the token field is write-only — blank keeps the existing value, 清除 removes it;
2. **Headless / CLI**: put `MINERU_API_TOKEN: <token>` in `$DSH_HOME/.credentials.yaml`;
3. **Environment variable**: export `MINERU_API_TOKEN`.

The token is resolved once per operation — **a rotation applies to the very next call without a restart**. Logs, errors, and Settings responses **never contain the secret**.

### language values

| Value | Meaning | Value | Meaning |
| --- | --- | --- | --- |
| `ch` | Chinese + English (default) | `ch_server` | Chinese (server-side) |
| `en` | English | `japan` | Japanese |
| `korean` | Korean | `chinese_cht` | Traditional Chinese |
| `latin` | Latin script | `arabic` | Arabic |
| `cyrillic` | Cyrillic script | `east_slavic` | East Slavic |
| `devanagari` | Devanagari | `th` | Thai |
| `ta` | Tamil | `te` | Telugu |
| `ka` | Georgian | `el` | Greek |

## Usage tips

- **Drag-and-drop**: drop a file into the chat — it is saved to the session workspace and its **path is filled into the composer draft (never auto-sent)**; add your request and send. This bypasses the native image-attachment channel that text-only models reject;
- **URL caveat**: MinerU fetches the URL server-side — **it cannot reach blocked sites** (github.com, AWS, etc.). Download such documents locally first and pass a path;
- **Page ranges**: Precision uses `pageRanges` (`"2,4-6"`; `"2--2"` = 2nd from last); Agent uses `pageRange` (`"1-10"`);
- **Long documents**: prefer Precision + `pageRanges` in chunks; the `vlm` model handles formulas and complex layouts best;
- **Timeout recovery**: a timeout is not a failure — the task keeps running server-side; collect it later with `mineru_task` + `taskId`;
- **HTML documents**: Precision only, and the `MinerU-HTML` model is forced automatically;
- **HTML daily quota**: HTML submissions have a separate official cap (max 100/day).

## Web UI

- **Settings → Plugins → MinerU 解析**: write-only token, mode, model, language, table/formula/OCR switches, extra formats, plus a collapsible **Advanced** section (timeouts/polling/rate limits, API base URL, credential reference, artifact root name). Every action shows immediate feedback (busy states and result messages); saves are revision-fenced (409 conflict → reload and retry);
- **Test buttons**: 测试 Token submits the official one-page demo PDF to verify the key (≈ 1 page of quota); 测试 Agent API verifies the tokenless channel (IP rate-limited);
- **Tool cards**: results of the three parsing tools render as dedicated cards — mode badge, duration, task id, artifact chips (open / preview), bounded preview, per-item batch outcomes.

## Rate limits & reliability

**Official MinerU limits** (the plugin enforces local equivalents and backoff; requests beyond the limits are rejected with HTTP 429):

| Dimension | Official limit | Plugin local default |
| --- | --- | --- |
| Submissions | 50 files/min | 40/min |
| Daily submissions | 5000 files/day/user (HTML: max 100/day) | 5000 (fails fast locally) |
| Result queries | 1000/min | 900/min |

Plugin behavior:

- Built-in **token buckets** (separate for submit/query) — local requests queue instead of hammering the API;
- HTTP 429 honors `Retry-After` with **automatic backoff and retry**;
- Polling carries random jitter (`pollJitterMs`) so requests do not line up;
- On whole-operation timeout (`timeoutMs`) the task is not lost — collect it later with `mineru_task` + `taskId`.

## Error code reference

| Code | Meaning | What to do |
| --- | --- | --- |
| `A0202` / `A0211` | Token invalid / expired | Update the MinerU token in Settings |
| `-60005` / `-30001` | File too large (200 MB / 10 MB) | Compress or split the file |
| `-60006` / `-30003` | Too many pages (200 / 20) | Split with `pageRanges` / `pageRange` |
| `-60018` | Daily quota exhausted | Try again tomorrow; check `dailySubmitLimit` |
| `429` | Too many requests | Retry later or lower concurrency |
| `MINERU_TOKEN_REQUIRED` | Token-required operation without a token | Configure a token or use Agent mode |
| `MINERU_UNSUPPORTED_TYPE` | Format unsupported by the current API | Switch format or API mode |
| `MINERU_BATCH_TOO_LARGE` | Batch exceeds 1000 items | Split into multiple calls |

Every error is mapped to an **actionable message** instead of a raw code.

## Security model

- **Path isolation**: input paths resolve against the session workspace; files outside it cannot be read;
- **ZIP unpacking guards**: rejects absolute paths, `..` traversal, encrypted entries, and ZIP64, with entry-count and byte caps, and verifies CRC32 on every extracted entry;
- **Artifact boundary**: written only under `<workspace>/.dsh-mineru`; preview URLs are HMAC-signed with expiry and re-validated on every read;
- **Web routes**: same-origin only; HTML/SVG artifacts are served as attachments with `nosniff`;
- **Cancellable**: all network work honors the tool-call abort signal — cancel/timeout stops uploads, polling, and downloads;
- **Secrets never leave the vault**: the token lives only in the credentials layer; logs/errors/Settings responses never carry it.

## FAQ

**Q: Can I use it without a token?**
Yes. It falls back to the tokenless Agent API (≤ 10 MB, ≤ 20 pages, Markdown only) — fine for quick reads.

**Q: Why is only `mineru_activate` in my tool list?**
That is progressive exposure by design. Call `mineru_activate` once and the other three tools unlock; or set `exposeMode: always` to register everything globally.

**Q: My parse timed out — is the file lost?**
No. The task keeps running on MinerU's servers; use `mineru_task` (`taskId` + `api`) anytime to query progress and collect the result without resubmitting.

**Q: Why didn't the parse start after I dropped a file?**
Drag-and-drop only fills the path into the composer draft (to avoid accidental sends). Add your request and press send; the agent then starts parsing.

**Q: A0202 / A0211 errors?**
The token is invalid or expired. Re-enter it in Settings → Plugins → MinerU 解析 (a blank save keeps the old value).

**Q: Can I parse HTML pages?**
Yes, but Precision API only (token required), and the MinerU-HTML model is forced. Note the server cannot reach blocked URLs.

**Q: How do I batch-parse?**
Use `mineru_batch_parse` with a list of paths/URLs — auto-chunked (local ≤ 50/batch, URLs ≤ 200/batch, ≤ 1000 per call).

**Q: What's the difference between the Agent and Precision results?**
Agent produces Markdown only. Precision additionally yields `content_list.json`, `layout.json`, `model.json`, embedded images, optional docx/html/latex exports, and table/formula recognition controls.

## Development & publishing

No build step: `lib/` ships loadable ESM and `lib/client.js` is the packed browser bundle.

```bash
node --check lib/*.js      # syntax check
npm pack                   # pack a local tarball
```

For a new release, follow the checklist in [RELEASE.md](RELEASE.md) (bump version → update CHANGELOG and both READMEs → pack & verify → tag & push → `npm publish`); see [CONTRIBUTING.md](CONTRIBUTING.md) for the full development loop.

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please **never paste a MinerU token** into an issue.

## License

[MIT](LICENSE). MinerU is provided by [OpenDataLab](https://opendatalab.com); its official docs ([API](https://mineru.net/apiManage/docs), [rate limits](https://mineru.net/apiManage/limit)) remain authoritative.
