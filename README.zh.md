# dsh-mineru

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.1.7-blue)](https://github.com/Lee-Hilex/dsh-mineru/releases)
[![dsh](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.6%2B-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness)
[![MinerU](https://img.shields.io/badge/MinerU-API-4d6bfe)](https://mineru.net/apiManage/docs)

> 仓库: <https://github.com/Lee-Hilex/dsh-mineru> · npm: [`dsh-mineru`](https://www.npmjs.com/package/dsh-mineru) · [更新日志](CHANGELOG.md)

[English](README.md) | 简体中文

## 目录

- [特性一览](#特性一览) · [安装](#安装) · [两种 API 模式](#两种-api-模式) · [工具](#工具) · [配置](#配置) · [限流与可靠性](#限流与可靠性) · [Web 界面](#web-界面) · [安全模型](#安全模型) · [开发](#开发) · [发布](#发布) · [贡献](#贡献) · [许可](#许可)

**dsh-mineru** 给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 提供基于 [MinerU](https://mineru.net) 的多模态全格式文档解析能力：PDF、Word、PowerPoint、Excel、HTML、图片 → 结构化 Markdown。**填写 MinerU Token 走 🎯 精准解析 API；Token 留空走 ⚡ Agent 轻量解析 API（免登录，IP 限频）。**

## 特性一览

- **双 API 模式自动选择** — 有 Token 用精准解析 API（≤200MB、≤200 页，模型 `pipeline`/`vlm`/`MinerU-HTML`，Zip 输出 `full.md` + JSON + 可选 docx/html/latex）；无 Token 用 Agent 轻量解析 API（≤10MB、≤20 页，仅 Markdown，免登录）。
- **四个工具、渐进式曝光** — `mineru_parse`、`mineru_batch_parse`（自动分批）、`mineru_task`（超时续收），外加 `mineru-tools` 技能；平时只有极小的 `mineru_activate` 引导工具可见，激活后才挂载完整工具集。
- **拖拽上传，纯文本模型也能用** — 把 PDF/Office 文档/图片直接拖进聊天窗口：文件先落到会话工作区，其路径会**填入输入框草稿（不自动发送）**，由你补充需求后自行发送，完全绕开纯文本模型会拒绝的原生图片附件通道。
- **限流感知** — 内置令牌桶（提交 40 次/分钟、查询 900 次/分钟）、每日提交计数、HTTP 429 按 `Retry-After` 退避重试、全部错误码映射为可操作提示。
- **Artifact 与 Web 界面** — 结果解包到 `<workspace>/.dsh-mineru/artifacts/`，附带 HMAC 签名预览链接；Web 设置有专属卡片（Token 只写、高级设置折叠、操作即时反馈）与专属工具结果卡片。

## 安装

前置：DeepSeek Harness `0.1.0-rc.6`（或兼容的 `0.1.x`）、`pnpm` 可用。

```
dsh plugin --profile web add dsh-mineru
dsh plugin --profile headless add dsh-mineru
```

重启 Web profile 后，在 **设置 → 插件 → MinerU 解析** 中配置 Token 与解析选项；在会话中输入 `/mineru-tools` 或让 Agent 调用 `skill` 工具加载 `mineru-tools` 技能。Headless 与 Web 共用同一套工具语义。

本地开发版请用打包后的 tgz 安装（见 [CONTRIBUTING.md](CONTRIBUTING.md)）：

```
dsh plugin --profile web add <路径>/dsh-mineru-<version>.tgz
```

## 两种 API 模式

| 维度 | 🎯 精准解析 API（需 Token） | ⚡ Agent 轻量解析 API（免 Token） |
| --- | --- | --- |
| 接口 | `/api/v4/extract/task`、`/api/v4/file-urls/batch`、`/api/v4/extract/task/batch` | `/api/v1/agent/parse/url`、`/api/v1/agent/parse/file` |
| 模型 | `pipeline` / `vlm`（默认）/ `MinerU-HTML` | 固定 pipeline 轻量模型 |
| 限制 | ≤200MB、≤200 页 | ≤10MB、≤20 页 |
| 批量 | ✅（URL 每批 ≤200、本地上传每批 ≤50，自动分批） | ❌ 单文件 |
| 输出 | Zip：`full.md` + `*_content_list.json` + `layout.json` + 图片（可加 docx/html/latex） | 仅 Markdown |

模式解析：`mode=auto`（默认）按 Token 是否配置自动选择；`mode=precision` 强制精准解析（无 Token 直接报错）；`mode=agent` 强制轻量解析。HTML 文件仅精准解析支持，并自动强制 `MinerU-HTML` 模型。

## 工具

| 工具 | 说明 |
| --- | --- |
| `mineru_activate` | 引导工具（progressive 模式可见）：一次调用解锁其余工具，之后对本会话隐藏 |
| `mineru_parse` | 解析单个文档：工作区文件路径或 http(s) URL；签名上传、异步轮询、结果落地为 Artifact |
| `mineru_batch_parse` | 精准解析批量解析：本地路径与 URL 混合列表，自动分批（每批 ≤50 文件 / ≤200 URL，单次 ≤1000），逐项报告成败 |
| `mineru_task` | 查询 / 收集已提交任务（`taskId` + `api`）——超时后恢复收集，无需重复提交 |

所有解析结果写入 `<workspace>/.dsh-mineru/artifacts/<run>/`：精准解析为完整解包的 Zip（`full.md` 等），Agent 模式为 `full.md`；另有 `run.json` 元数据。工具结果包含限长的 Markdown 预览、任务 ID、耗时与 Artifact 列表（含签名预览链接）。Web 界面的工具卡片可直接打开/预览文件；Headless 直接复用列表中的绝对路径。

## 配置

配置分三层：schema 默认值 ← 组合层（profile patch 中的 `mineru` 行 config）← 用户设置（Web 设置卡片写入）。

```
- id: mineru
  config:
    mode: auto            # auto | precision | agent
    modelVersion: vlm     # pipeline | vlm | MinerU-HTML
    language: ch
    enableTable: true
    enableFormula: true
    isOcr: false
    extraFormats: []      # docx | html | latex (精准解析)
    exposeMode: progressive  # progressive: mineru_activate 引导; always: 全局注册
    timeoutMs: 600000
    pollIntervalMs: 3000
    inlineMarkdownBytes: 12000
    submitRatePerMin: 40
    pollRatePerMin: 900
    dailySubmitLimit: 5000
    artifactRootName: .dsh-mineru
```

### Token（DSH Credentials）

配置只保存**凭据引用名**（默认 `MINERU_API_TOKEN`），Token 值只存在于凭据层：

- Web 设置卡片：Token 输入框只写不读，留空保留现有值，`清除` 删除；
- Headless / 命令行：`$DSH_HOME/.credentials.yaml` 中写入 `MINERU_API_TOKEN: <token>`，或用环境变量 `MINERU_API_TOKEN`。

Token 在每次操作时实时解析——轮换后下一次调用立即生效，无需重启。日志、错误与设置响应永不携带密钥。

### language 取值

`ch`（中英，默认）、`ch_server`、`en`、`japan`、`korean`、`chinese_cht`、`ta`、`te`、`ka`、`el`、`th`、`latin`、`arabic`、`cyrillic`、`east_slavic`、`devanagari`。

## 限流与可靠性

- 客户端内置令牌桶：提交默认 40 个/分钟（官方 50）、查询 900 次/分钟（官方 1000）、每日 5000 个（官方限额，本地提前报错）；
- 命中 HTTP 429 时按 `Retry-After` 退避并自动重试；
- 轮询带随机抖动；整体超时后不丢任务——用 `mineru_task` 凭 `taskId` 继续收集；
- 错误码全部映射为可操作的中文提示（A0202/A0211 Token、-60005/-60006 尺寸/页数、-30001~-30003 Agent 限制、-60018 配额等）。

## Web 界面

- **设置 → 插件 → MinerU 解析**：Token（只写）、模式、模型、语言、识别开关、额外格式，以及可折叠的 **高级设置**（超时/限速/限额、API 地址、凭据引用名、Artifact 根目录名）。每个操作都有即时反馈（忙碌状态与结果消息）；保存带修订冲突检测（409 → 重新加载后重试）；`测试 Token` 提交官方一页示例 PDF 验证密钥（约消耗 1 页额度）；`测试 Agent API` 验证免登录通道（受 IP 限频）。
- **工具卡片**：`mineru_parse` / `mineru_batch_parse` / `mineru_task` 的结果以专属卡片呈现：模式徽章、耗时、任务 ID、Artifact 列表（点击打开 / 链接预览）、限长预览、逐项批量结果。

## 安全模型

- 输入路径以会话工作区为根解析；ZIP 解包拒绝绝对路径、`..` 穿越、加密与 ZIP64，并带数量/体积上限，解出的每个条目都校验 CRC32；
- Artifact 只写入 `<workspace>/.dsh-mineru`，预览 URL 为 HMAC 签名 + 过期时间，每次读取重新校验；
- Web 路由仅接受同源请求；HTML/SVG 等 Artifact 以附件方式下发（`nosniff`）；
- 所有网络请求可被工具取消信号中止（会话取消/超时即停止上传、轮询与下载）。

## 开发

本包不依赖构建步骤：`lib/` 为可直接加载的 ESM，`lib/client.js` 为打包形态的浏览器 bundle（`dsh.client` → `./client` 导出）。

```
node --check lib/*.js      # 语法检查
npm pack                    # 打包本地 tgz
```

本地路径安装请用 tgz（pnpm `link:` 安装会使 `@deepseek-ai` 依赖解析脱离 profile）；完整开发循环见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 发布

```
npm pack
npm publish                 # 需先 npm login
dsh plugin --profile web add dsh-mineru   # 发布后用户安装
```

## 贡献

欢迎 Issue 与 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。报告问题时请勿贴出 MinerU Token。

## 许可

[MIT](LICENSE)。MinerU 由 OpenDataLab 提供，其官方文档（[API 文档](https://mineru.net/apiManage/docs)、[限流策略](https://mineru.net/apiManage/limit)）为权威依据。
