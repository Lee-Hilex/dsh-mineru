# dsh-mineru

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.6%2B-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness)
[![MinerU](https://img.shields.io/badge/MinerU-API-4d6bfe)](https://mineru.net/apiManage/docs)

> Repository: <https://github.com/Lee-Hilex/dsh-mineru> · npm: [`dsh-mineru`](https://www.npmjs.com/package/dsh-mineru)

English | [简体中文](README.zh.md)

**dsh-mineru** brings [MinerU](https://mineru.net)-powered multimodal, full-format document parsing to [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): PDF, Word, PowerPoint, Excel, HTML, and images all become structured Markdown. Provide a MinerU token to use the Precision API, or leave it blank to use the tokenless Agent API.

## Highlights

- **Dual API modes, auto-selected** — with a token the plugin uses the Precision API (up to 200 MB / 200 pages, models `pipeline`/`vlm`/`MinerU-HTML`, Zip output with `full.md` + JSON + optional docx/html/latex); without a token it uses the Agent API (up to 10 MB / 20 pages, Markdown-only, no sign-in).
- **Four tools, progressive exposure** — `mineru_parse`, `mineru_batch_parse` (auto-chunked batches), `mineru_task` (resume after timeout), plus the `mineru-tools` skill; only the tiny `mineru_activate` bootstrap is visible until the agent activates the toolset.
- **Drag-and-drop uploads that work with text-only models** — drop PDFs/Office documents/images into the chat; files land in the session workspace and their paths are filled into the composer draft (never auto-sent) — you add your own request and press send, bypassing the native image-attachment channel that text-only models reject.
- **Rate-limit aware** — built-in token buckets (40 submits/min, 900 queries/min), daily submit accounting, `Retry-After` backoff on HTTP 429, and actionable messages for every MinerU error code.
- **Artifacts & Web UI** — results are extracted under `<workspace>/.dsh-mineru/artifacts/` with HMAC-signed preview URLs, a dedicated Web Settings card (write-only token, collapsible advanced section, busy/result feedback), and custom tool-result cards.

## Install

Prerequisites: DeepSeek Harness `0.1.0-rc.6` (or a compatible `0.1.x`), and `pnpm` available to `dsh plugin`.

```
dsh plugin --profile web add dsh-mineru
dsh plugin --profile headless add dsh-mineru
```

Restart a running Web profile, then open **Settings → Plugins → MinerU 解析** to configure the token and parsing options. In a conversation, type `/mineru-tools` or let the agent load the `mineru-tools` skill. Web and Headless share the same tool semantics.

For a local build, install from the packed tarball (see [CONTRIBUTING.md](CONTRIBUTING.md)):

```
dsh plugin --profile web add <path>/dsh-mineru-<version>.tgz
```

## Two API modes

| | Precision API (token required) | Agent API (tokenless) |
| --- | --- | --- |
| Endpoints | `/api/v4/extract/task`, `/api/v4/file-urls/batch`, `/api/v4/extract/task/batch` | `/api/v1/agent/parse/url`, `/api/v1/agent/parse/file` |
| Models | `pipeline` / `vlm` (default) / `MinerU-HTML` | fixed lightweight pipeline |
| Limits | ≤ 200 MB, ≤ 200 pages | ≤ 10 MB, ≤ 20 pages |
| Batch | yes (URLs ≤ 200/batch, local uploads ≤ 50/batch, auto-chunked) | no, single file |
| Output | Zip: `full.md` + `*_content_list.json` + `layout.json` + images (+ optional docx/html/latex) | Markdown only |

Mode resolution: `mode=auto` (default) selects by token presence; `mode=precision` forces the Precision API (fails loudly without a token); `mode=agent` forces the Agent API. HTML files are Precision-only and automatically force `MinerU-HTML`.

## Tools

| Tool | Description |
| --- | --- |
| `mineru_activate` | Bootstrap tool (visible in progressive mode): one call unlocks the rest of the toolset for the session, then hides itself. |
| `mineru_parse` | Parse one document: a workspace file path or an http(s) URL. Signature upload, async polling, results written as Artifacts. |
| `mineru_batch_parse` | Precision-API batch parsing: a mixed list of local paths and URLs, auto-chunked (≤ 50 files / ≤ 200 URLs per batch, ≤ 1000 per call), per-item results. |
| `mineru_task` | Query and optionally collect an already-submitted task (`taskId` + `api`) — resume a timed-out parse without resubmitting. |

All results land under `<workspace>/.dsh-mineru/artifacts/<run>/`: for the Precision API this is the fully unpacked Zip (`full.md` etc.), for the Agent API it is `full.md`; a `run.json` metadata file is always included. Tool results carry a bounded Markdown preview, the task id, duration, and the artifact list (with signed preview links). The Web tool cards open/preview files directly; Headless agents reuse the absolute paths.

## Configure

Configuration resolves in three layers: schema defaults ← composition layer (the `mineru` row config in a profile patch) ← the user settings document (written through the Web Settings card).

```
- id: mineru
  config:
    mode: auto            # auto | precision | agent
    modelVersion: vlm     # pipeline | vlm | MinerU-HTML
    language: ch
    enableTable: true
    enableFormula: true
    isOcr: false
    extraFormats: []      # docx | html | latex (Precision API)
    exposeMode: progressive  # progressive: mineru_activate bootstrap; always: register everything globally
    timeoutMs: 600000
    pollIntervalMs: 3000
    inlineMarkdownBytes: 12000
    submitRatePerMin: 40
    pollRatePerMin: 900
    dailySubmitLimit: 5000
    artifactRootName: .dsh-mineru
```

### Token (DSH Credentials)

The configuration stores only the **credential reference name** (default `MINERU_API_TOKEN`); the token value lives in the credentials layer:

- Web Settings: the token field is write-only — blank keeps the existing value, 清除 removes it;
- Headless / CLI: put `MINERU_API_TOKEN: <token>` in `$DSH_HOME/.credentials.yaml`, or export `MINERU_API_TOKEN`.

The token is resolved once per operation, so a rotation applies to the very next call without a restart. Logs, errors, and Settings responses never contain the secret.

### language values

`ch` (Chinese + English, default), `ch_server`, `en`, `japan`, `korean`, `chinese_cht`, `ta`, `te`, `ka`, `el`, `th`, `latin`, `arabic`, `cyrillic`, `east_slavic`, `devanagari`.

## Rate limits & reliability

- Client-side token buckets: 40 submissions/min by default (official: 50), 900 result queries/min (official: 1000), and a daily cap of 5000 (official) that fails fast locally.
- HTTP 429 honors `Retry-After` with automatic backoff and retry.
- Polling carries random jitter; on timeout the task is not lost — collect it later with `mineru_task` using the `taskId`.
- Error codes map to actionable messages (A0202/A0211 token problems, -60005/-60006 size/pages, -30001~-30003 Agent limits, -60018 daily quota, and more).

## Web UI

- **Settings → Plugins → MinerU 解析**: write-only token, mode/model/language, recognition switches, extra formats, plus a collapsible **Advanced** section (timeouts, rate limits, endpoint, credential reference, artifact root). Every action shows immediate feedback (busy states and result messages); saves are revision-fenced (409 conflict → reload and retry); 测试 Token submits the official one-page demo PDF to verify the key (about 1 page of quota); 测试 Agent API verifies the tokenless channel (IP rate-limited).
- **Tool cards**: `mineru_parse` / `mineru_batch_parse` / `mineru_task` results render as dedicated cards with the mode badge, duration, task id, artifact chips (open / preview), a bounded preview, and per-item batch outcomes.

## Security model

- Input paths resolve against the session workspace; ZIP unpacking rejects absolute paths, `..` traversal, encrypted entries, and ZIP64, with entry-count and byte caps, and verifies CRC32 on every extracted entry.
- Artifacts are written only under `<workspace>/.dsh-mineru`; preview URLs are HMAC-signed with expiry and re-validated on every read.
- Web routes accept same-origin requests only; HTML/SVG artifacts are served as attachments with `nosniff`.
- All network work honors the tool-call abort signal (cancel/timeout stops uploads, polling, and downloads).

## Development

The package needs no build step: `lib/` ships loadable ESM and `lib/client.js` is the packed browser bundle (`dsh.client` → the `./client` export).

```
node --check lib/*.js      # syntax check
npm pack                    # pack a local tarball
```

Local path installs must use the tarball (pnpm `link:` installs resolve `@deepseek-ai` peers outside the profile); see [CONTRIBUTING.md](CONTRIBUTING.md) for the full loop.

## Publishing

```
npm pack
npm publish                 # requires npm login
dsh plugin --profile web add dsh-mineru   # user install after publishing
```

## Contributing

Issues and pull requests are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md). Please never paste a MinerU token into an issue.

## License

[MIT](LICENSE). MinerU is provided by OpenDataLab; its official docs ([API](https://mineru.net/apiManage/docs), [rate limits](https://mineru.net/apiManage/limit)) remain authoritative.
