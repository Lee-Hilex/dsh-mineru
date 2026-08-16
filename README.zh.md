# dsh-mineru

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![version](https://img.shields.io/badge/version-0.1.8-blue)](https://github.com/Lee-Hilex/dsh-mineru/releases)
[![dsh](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.6%2B-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness)
[![MinerU](https://img.shields.io/badge/MinerU-API-4d6bfe)](https://mineru.net/apiManage/docs)

> 仓库: <https://github.com/Lee-Hilex/dsh-mineru> · npm: [`dsh-mineru`](https://www.npmjs.com/package/dsh-mineru) · [更新日志](CHANGELOG.md)

[English](README.md) | 简体中文

**dsh-mineru** 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（简称 dsh）的 **MinerU 多模态文档解析插件**：把 PDF、Word、PPT、Excel、HTML 和图片一键转成**结构化 Markdown**。**配置了 MinerU Token 走 🎯 精准解析 API；不配 Token 也能用 ⚡ Agent 轻量解析 API（免登录，IP 限频）。**

## 目录

- [简介](#简介) · [快速开始](#快速开始) · [两种 API 模式](#两种-api-模式) · [工具详解](#工具详解) · [解析结果与 Artifacts](#解析结果与-artifacts) · [配置参考](#配置参考) · [使用技巧](#使用技巧) · [Web 界面](#web-界面) · [限流与可靠性](#限流与可靠性) · [错误码速查](#错误码速查) · [安全模型](#安全模型) · [常见问题 FAQ](#常见问题-faq) · [开发与发布](#开发与发布) · [贡献](#贡献) · [许可](#许可)

## 简介

### 这是什么？

dsh-mineru 把 [MinerU](https://mineru.net)（OpenDataLab 出品的高精度文档解析引擎）接入 DeepSeek Harness 的 Agent 生态，让**纯文本模型也能"看懂"文档**：模型拿到的是结构化 Markdown（含表格、公式、图片），而不是打不开的二进制文件。

典型场景：

- 读论文 / 合同 / 报告：让 Agent 解析 PDF 后总结要点、提取数据；
- 批量整理资料：一次解析几十份文档，逐项产出 Markdown；
- 图片 / 截图转文字：OCR 扫描件、网页截图转可检索文本；
- 公式与表格还原：论文中的数学公式、Excel 表格结构完整保留。

### 支持的文件格式

| 格式 | 精准解析 API（需 Token） | Agent 轻量 API（免 Token） |
| --- | --- | --- |
| PDF | ✅ | ✅ |
| Word（`.doc` / `.docx`） | ✅ | ✅（仅 `.docx`） |
| PPT（`.ppt` / `.pptx`） | ✅ | ✅（仅 `.pptx`） |
| Excel（`.xls` / `.xlsx`） | ✅ | ✅（仅 `.xlsx`） |
| HTML（`.html` / `.htm`） | ✅（自动强制 MinerU-HTML 模型） | ❌ |
| 图片（`.png` `.jpg` `.jpeg` `.jp2` `.webp` `.gif` `.bmp`） | ✅ | ✅ |

> 注：Agent 轻量 API 不支持 `.doc` / `.ppt` / `.xls`（旧版 Office 格式）与 HTML，遇到这类文件请改用精准解析（需 Token）。

### 核心能力

- **双 API 自动切换** — 按是否配置 Token 自动选择精准解析或轻量解析，也可手动指定；
- **渐进式工具曝光** — 平时只挂一个极小的 `mineru_activate` 引导工具，激活后才挂载完整工具集，省上下文；
- **拖拽上传** — 文件直接拖进聊天窗口，路径自动填入输入框，纯文本模型也能处理文档；
- **自动分批批量解析** — 一次提交上百个文件/URL，自动按官方限额分批；
- **限流感知** — 内置令牌桶、每日限额、429 退避重试，错误码全部翻译成可操作提示；
- **结果落地为 Artifact** — 解析结果写入工作区文件，Web 界面可预览/打开，带签名链接。

## 快速开始

### 第 1 步：安装

> **Note**: 需要已安装 DeepSeek Harness（`0.1.0-rc.6` 或兼容的 `0.1.x`），且 `dsh` 命令可用。

**从 npm 安装（推荐）**

```bash
dsh plugin --profile web add dsh-mineru        # Web 界面使用
dsh plugin --profile headless add dsh-mineru   # 无头（Headless）模式使用
```

**从源码构建**（开发 / 预览最新改动）

```bash
git clone git@github.com:Lee-Hilex/dsh-mineru.git
cd dsh-mineru
npm install        # 安装 peer 依赖（本包无构建步骤，无需 build）
npm pack           # 产出 dsh-mineru-<version>.tgz
dsh plugin --profile web add ./dsh-mineru-<version>.tgz
```

修改源码后重新 `npm pack` 并重装即可。注意本地安装请用 tgz（`pnpm link:` 安装会使 `@deepseek-ai` 依赖解析脱离 profile）。

### 第 2 步：验证安装

```bash
dsh --profile web --dump-config | grep -A 2 "id: mineru"
```

期望输出（`# ==` 注释行 + 你的插件行）：

```
# == dsh-mineru
  - id: mineru
    name: dsh-mineru
```

然后重启 Web profile（`dsh web`），在 **设置 → 插件 → MinerU 解析** 中即可看到本插件。

### 第 3 步：配置（可选）

**不配 Token 也能用**（自动走 Agent 轻量解析）。配 Token 可以解锁完整能力（精准解析 + 批量 + HTML + 更多格式）：

- **Web 界面**：设置 → 插件 → **MinerU 解析** → 在 Token 输入框粘贴 Token（只写不读，留空保留现有值）；
- **Headless / 命令行**：在 `$DSH_HOME/.credentials.yaml` 写入 `MINERU_API_TOKEN: <你的Token>`，或设置环境变量 `MINERU_API_TOKEN`。

Token 每次调用时实时解析，**轮换后无需重启立即生效**。Token 去哪领：<https://mineru.net> 注册后到 API 管理页面获取。

### 第 4 步：开始使用

**Web 界面**（推荐方式，支持拖拽）：

1. 把 PDF/Word/图片直接**拖进聊天窗口** —— 文件会自动保存到会话工作区，路径填入输入框（不会自动发送）；
2. 在输入框补一句需求，比如「把这份 PDF 解析成 Markdown，然后总结一下重点」；
3. 发送。Agent 会自动激活工具并调用 `mineru_parse`，解析结果以文件形式返回，可点击预览。

**URL 解析**：直接告诉 Agent「解析这个网页/文档：https://example.com/paper.pdf」即可。

**Headless 快速验证（冒烟测试）**：一次性任务走 headless profile：

```bash
dsh --profile headless "把 C:/docs/sample.pdf 解析成 Markdown，并总结前 3 段"
```

Headless 与 Web 共用同一套工具语义；也可以在会话中输入 `/mineru-tools` 加载使用说明技能。

## 两种 API 模式

| 维度 | 🎯 精准解析 API（需 Token） | ⚡ Agent 轻量解析 API（免 Token） |
| --- | --- | --- |
| 接口 | `/api/v4/extract/task`、`/api/v4/file-urls/batch`、`/api/v4/extract/task/batch` | `/api/v1/agent/parse/url`、`/api/v1/agent/parse/file` |
| 模型 | `pipeline` / `vlm`（默认）/ `MinerU-HTML` | 固定轻量 pipeline 模型 |
| 大小限制 | ≤ 200 MB | ≤ 10 MB |
| 页数限制 | ≤ 200 页 | ≤ 20 页 |
| 批量解析 | ✅（URL 每批 ≤200，本地上传每批 ≤50，自动分批） | ❌ 仅单文件 |
| 输出 | Zip：`full.md` + `content_list.json` + `layout.json` + 图片（可加 docx/html/latex） | 仅 Markdown |
| 适用场景 | 长文档、扫描件、公式表格、批量、HTML | 快速粗读、小文件、临时使用 |

**模式选择**（`mode` 参数或配置项）：

- `auto`（默认）— 有 Token 走精准解析，没 Token 走 Agent 轻量；
- `precision` — 强制精准解析，没配 Token 会直接报错提示；
- `agent` — 强制 Agent 轻量解析。

想知道当前会话实际走的哪个 API：调用一次 `mineru_activate`，返回结果里的 `api` 字段会明确告诉你（`precision` 或 `agent`）。

## 工具详解

安装后，工具集默认**渐进式曝光**：一开始只有 `mineru_activate` 一个引导工具，调用一次即解锁其余三个工具，随后 `mineru_activate` 对本会话自动隐藏。

### `mineru_activate` —— 激活引导

| 项 | 说明 |
| --- | --- |
| 用途 | 解锁 `mineru_parse` / `mineru_batch_parse` / `mineru_task` 并加载 `mineru-tools` 技能 |
| 参数 | 无 |
| 返回 | 当前生效的 API 模式、是否已配 Token、各 API 限制等现状摘要 |

### `mineru_parse` —— 解析单个文档

将**工作区文件路径**或 **http(s) URL** 解析为结构化 Markdown。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `source` | ✅ | 工作区文件路径，或完整 http(s) URL |
| `mode` | | `auto`（默认）/ `precision` / `agent` |
| `modelVersion` | | 精准解析模型：`pipeline` / `vlm`（默认，推荐）/ `MinerU-HTML`（HTML 源自动强制） |
| `language` | | 文档语言包，默认 `ch`（中英），见 [language 取值](#配置参考) |
| `enableTable` | | 表格识别，默认 `true` |
| `enableFormula` | | 公式识别，默认 `true` |
| `isOcr` | | 强制 OCR（扫描件），默认 `false` |
| `pageRanges` | | 精准解析页码范围，逗号分隔，如 `"2,4-6"`；支持倒数页 `"2--2"`（倒数第 2 页） |
| `pageRange` | | Agent 解析页码范围，仅 `from-to` 或单页，如 `"1-10"` |
| `extraFormats` | | 额外导出格式（仅精准解析）：`docx` / `html` / `latex` |
| `dataId` | | 业务数据 ID（可选，≤128 字符） |
| `timeoutMs` | | 整个操作（含轮询）超时，默认取插件配置（10 分钟） |
| `output` | | 结果目录基名，默认取源文件名 |

**返回要点**：`ok`、所用 `api`/`modelVersion`、`taskId`、耗时、`runDir` 结果目录、截断的 Markdown 预览、Artifact 列表（Web 含签名预览链接）。

### `mineru_batch_parse` —— 批量解析（仅精准解析）

一次解析多个文档，**本地文件路径与 URL 可混用**，自动分批提交（官方限额内），逐项报告成功/失败。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `sources` | ✅ | 文件路径 / URL 混合列表 |
| `outputPrefix` | | 结果目录基名，默认 `batch` |
| `dataIdPrefix` | | 业务数据 ID 前缀，每项自动追加序号（可选） |
| 其余 | | 同 `mineru_parse` 的公共选项（`mode` 除外——本工具强制精准解析） |

**分批规则**：本地文件每批 ≤ 50 个、URL 每批 ≤ 200 个、单次调用总共 ≤ 1000 个；超出会报错并提示拆分调用。

**返回要点**：成功/失败计数、各 `batchId`、逐项结果（每个成功项包含其 `full.md` 所在目录），失败项附错误信息。

### `mineru_task` —— 任务查询与结果收集

解析**超时后不丢任务**：凭 `mineru_parse` 返回的 `taskId` + `api` 继续查询进度、收集结果，无需重新提交。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `taskId` | ✅ | 提交任务时返回的 task_id |
| `api` | ✅ | 任务所属：`precision` 或 `agent` |
| `wait` | | 是否轮询等待任务完成，默认 `false`（只查一次） |
| `collect` | | 任务完成时是否下载结果落地为 Artifact，默认 `true` |
| `output` | | 收集结果目录基名，默认 `task` |
| `timeoutMs` | | `wait` 模式下的超时 |

**典型场景**：解析大 PDF 时 `mineru_parse` 超时了 → 告诉 Agent「用 mineru_task 继续收集 taskId=xxx 的结果」。

### `mineru-tools` 技能

插件自带同名技能：会话中输入 `/mineru-tools` 或让 Agent 调用 `skill` 工具加载，即可获得工具清单、双 API 对比、使用要点与官方限制的完整说明（Agent 视角的使用手册）。

## 解析结果与 Artifacts

所有解析结果写入 **`<workspace>/.dsh-mineru/artifacts/<run>/`**（`<workspace>` 为当前会话工作区，`<run>` 为每次解析的独立目录）：

```
.dsh-mineru/artifacts/<run>/
├── full.md                  # 结构化 Markdown 主结果（两模式都有）
├── run.json                 # 本次解析元数据（来源、API、模型、耗时等）
├── *_content_list.json      # 内容结构化清单（仅精准解析）
├── layout.json              # 版面布局数据（仅精准解析）
├── *_model.json             # 模型原始输出（仅精准解析）
├── *_origin.pdf             # 服务端转换的原始文件（仅精准解析）
├── images/                  # 文档内嵌图片（仅精准解析）
└── result.zip               # 服务端原始结果包（仅精准解析）
```

- 工具结果里附**限长 Markdown 预览**（默认前 12 KB），完整内容请用 `read` 工具读取 `full.md`；
- **Web 界面**：Artifact 带 HMAC 签名预览链接（默认有效期 24 小时），点开即可看/下载；工具结果卡片可直接打开文件；
- **Headless**：直接使用返回的绝对路径。

批量解析时每个文档在独立子目录：`<run>/<文件名>/full.md`。

## 配置参考

配置分三层解析：**schema 默认值 ← 组合层（profile patch 中的 `mineru` 行 config）← 用户设置（Web 设置卡片写入）**，后一层覆盖前一层。

```yaml
# 组合层配置示例（cordis.patch.yml 或 profile patch）
- id: mineru
  config:
    mode: auto               # auto | precision | agent
    modelVersion: vlm        # pipeline | vlm | MinerU-HTML
    language: ch             # 文档语言包
    enableTable: true        # 表格识别
    enableFormula: true      # 公式识别
    isOcr: false             # 强制 OCR
    extraFormats: []         # docx | html | latex（仅精准解析）
    exposeMode: progressive  # progressive: 引导激活; always: 全局注册全部工具
    timeoutMs: 600000        # 整体超时（毫秒）
    pollIntervalMs: 3000     # 结果轮询间隔（毫秒）
    inlineMarkdownBytes: 12000  # 工具结果内联预览字节数
    submitRatePerMin: 40     # 提交限速（次/分钟）
    pollRatePerMin: 900      # 查询限速（次/分钟）
    dailySubmitLimit: 5000   # 每日提交限额
    artifactRootName: .dsh-mineru  # Artifact 根目录名
```

### 完整配置项

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `mode` | `auto` | API 模式：`auto`（按 Token 自动）/ `precision` / `agent` |
| `modelVersion` | `vlm` | 精准解析模型：`pipeline` / `vlm` / `MinerU-HTML`（HTML 源自动强制） |
| `language` | `ch` | 文档语言包（见下表） |
| `enableTable` | `true` | 表格识别开关 |
| `enableFormula` | `true` | 公式识别开关 |
| `isOcr` | `false` | 强制 OCR（扫描件） |
| `extraFormats` | `[]` | 额外导出格式（仅精准解析）：`docx` / `html` / `latex` |
| `exposeMode` | `progressive` | `progressive`：引导激活；`always`：全局注册全部工具 |
| `timeoutMs` | `600000` | 整个操作（含轮询）超时，范围 10 s ~ 1 h |
| `pollIntervalMs` | `3000` | 结果轮询间隔，范围 500 ~ 60000 ms |
| `pollJitterMs` | `500` | 轮询随机抖动，避免请求整齐划一 |
| `maxFileBytes` | `0` | 本地文件大小上限；`0` = 按 API 模式限额（200 MB / 10 MB） |
| `inlineMarkdownBytes` | `12000` | 工具结果内联的 Markdown 预览字节数 |
| `artifactUrlTtlSec` | `86400` | 签名预览链接有效期（秒），范围 60 s ~ 30 天 |
| `submitRatePerMin` | `40` | 提交限速（官方上限 50/分钟） |
| `pollRatePerMin` | `900` | 查询限速（官方上限 1000/分钟） |
| `dailySubmitLimit` | `5000` | 每日提交限额（官方上限 5000/天） |
| `tokenCredential` | `MINERU_API_TOKEN` | DSH 凭据引用名（只存引用，不存密钥） |
| `apiBaseUrl` | `https://mineru.net` | MinerU API 地址 |
| `artifactRootName` | `.dsh-mineru` | Artifact 根目录名（单层目录名） |
| `userAgent` | `dsh-mineru/<版本>` | 请求 User-Agent |

### Token 与凭据

配置中**只保存凭据引用名**（默认 `MINERU_API_TOKEN`），Token 值存放在 dsh 凭据层，三种方式任选：

1. **Web 设置卡片**：Token 输入框只写不读——留空保留现有值，点「清除」删除；
2. **Headless / 命令行**：`$DSH_HOME/.credentials.yaml` 写入 `MINERU_API_TOKEN: <token>`；
3. **环境变量**：设置 `MINERU_API_TOKEN`。

Token 每次操作实时解析——**轮换后下一次调用立即生效，无需重启**。日志、错误与设置响应**永不携带密钥**。

### language 取值

| 值 | 说明 | 值 | 说明 |
| --- | --- | --- | --- |
| `ch` | 中英（默认） | `ch_server` | 中文（服务端） |
| `en` | 英文 | `japan` | 日文 |
| `korean` | 韩文 | `chinese_cht` | 繁体中文 |
| `latin` | 拉丁语系 | `arabic` | 阿拉伯语 |
| `cyrillic` | 西里尔语系 | `east_slavic` | 东斯拉夫语系 |
| `devanagari` | 天城文 | `th` | 泰文 |
| `ta` | 泰米尔文 | `te` | 泰卢固文 |
| `ka` | 格鲁吉亚文 | `el` | 希腊文 |

## 使用技巧

- **拖拽上传**：把文件拖进聊天窗口即可——文件自动保存到会话工作区，**路径填入输入框草稿（不自动发送）**，你补一句需求再发送。这绕开了纯文本模型不支持的图片附件通道；
- **URL 注意**：MinerU 服务端会去抓取该 URL——**无法访问被墙站点**（如 github.com、aws 等）。这类文档请先下载到本地再传路径；
- **页码范围**：精准解析用 `pageRanges`（`"2,4-6"`，`"2--2"` 表示倒数第 2 页）；Agent 用 `pageRange`（`"1-10"`）；
- **长文档**：优先精准解析 + `pageRanges` 分段处理；`vlm` 模型对公式/复杂版面效果最好；
- **超时恢复**：解析超时不等于失败——任务还在服务端跑，用 `mineru_task` + `taskId` 继续收集；
- **HTML 文档**：仅精准解析支持，且自动强制 `MinerU-HTML` 模型（无需手动指定）；
- **HTML 文件每日限额**：官方对 HTML 提交有单独限制（最多 100 个/天）。

## Web 界面

- **设置 → 插件 → MinerU 解析**：Token（只写）、模式、模型、语言、表格/公式/OCR 开关、额外导出格式，以及可折叠的**高级设置**（超时/轮询/限速/限额、API 地址、凭据引用名、Artifact 根目录名）。每个操作都有即时反馈（忙碌状态与结果消息）；保存带修订冲突检测（409 冲突 → 重新加载后重试）；
- **测试按钮**：「测试 Token」提交官方一页示例 PDF 验证密钥（约消耗 1 页额度）；「测试 Agent API」验证免登录通道（受 IP 限频）；
- **工具卡片**：三个解析工具的结果以专属卡片呈现——模式徽章、耗时、任务 ID、Artifact 列表（点击打开 / 链接预览）、限长预览、逐项批量结果。

## 限流与可靠性

**MinerU 官方限流**（插件已内置本地限速与退避，超限的请求会被服务端以 HTTP 429 拒绝）：

| 维度 | 官方限额 | 插件本地默认 |
| --- | --- | --- |
| 提交 | 50 个文件/分钟 | 40 个/分钟 |
| 每日提交 | 5000 个文件/天/用户（HTML 最多 100 个/天） | 5000（本地提前报错） |
| 结果查询 | 1000 次/分钟 | 900 次/分钟 |

插件行为：

- 内置**令牌桶**限速（提交/查询分开），超限的本地请求排队而不是打爆 API；
- 命中 HTTP 429 时按 `Retry-After` **退避自动重试**；
- 轮询带随机抖动（`pollJitterMs`），避免请求整齐划一触发风控；
- 整体超时（`timeoutMs`）后任务不丢——用 `mineru_task` 凭 `taskId` 继续收集。

## 错误码速查

| 错误码 | 含义 | 处理方式 |
| --- | --- | --- |
| `A0202` / `A0211` | Token 错误 / 过期 | 在设置中更新 MinerU Token |
| `-60005` / `-30001` | 文件超限（200 MB / 10 MB） | 压缩或拆分文件 |
| `-60006` / `-30003` | 页数超限（200 页 / 20 页） | 用 `pageRanges` / `pageRange` 分段 |
| `-60018` | 当日配额已满 | 明天再试，或检查 `dailySubmitLimit` |
| `429` | 请求过于频繁 | 稍后重试或降低并发 |
| `MINERU_TOKEN_REQUIRED` | 需要 Token 的操作未配 Token | 配置 Token 或改用 Agent 模式 |
| `MINERU_UNSUPPORTED_TYPE` | 该格式不被当前 API 支持 | 换格式或换 API 模式 |
| `MINERU_BATCH_TOO_LARGE` | 单次批量超过 1000 个 | 拆分后多次调用 |

所有错误都会映射为**可操作的中文提示**，而不是原始错误码。

## 安全模型

- **路径隔离**：输入路径以会话工作区为根解析，不能读取工作区外文件；
- **ZIP 解包防护**：拒绝绝对路径、`..` 穿越、加密条目与 ZIP64，带条目数量/体积上限，每个解出的条目都校验 CRC32；
- **Artifact 边界**：只写入 `<workspace>/.dsh-mineru`；预览 URL 为 HMAC 签名 + 过期时间，每次读取重新校验；
- **Web 路由**：仅接受同源请求；HTML/SVG 等 Artifact 以附件方式下发（`nosniff`）；
- **可取消**：所有网络请求响应工具取消信号——会话取消/超时会立即停止上传、轮询与下载；
- **密钥不出库**：Token 只存在于凭据层，日志/错误/设置响应永不携带。

## 常见问题 FAQ

**Q：不配 Token 能用吗？**
能。自动走 Agent 轻量解析 API（≤10 MB、≤20 页、仅 Markdown、免登录），适合快速粗读。

**Q：为什么工具列表里只有 `mineru_activate`？**
这是渐进式曝光设计。调用一次 `mineru_activate`，其余三个工具立即解锁；或者把配置项 `exposeMode` 改为 `always` 全局注册。

**Q：解析超时了，文件会不会丢？**
不会。任务在 MinerU 服务端继续执行，用 `mineru_task`（`taskId` + `api`）随时查询进度并收集结果，无需重新提交。

**Q：拖拽文件后为什么没有自动解析？**
拖拽只把文件路径填入输入框草稿（防误发送），需要你补充需求后手动发送，Agent 才会开始解析。

**Q：报错 A0202 / A0211 怎么办？**
Token 无效或过期。在「设置 → 插件 → MinerU 解析」重新填写 Token（留空再点保存不会覆盖旧值）。

**Q：HTML 网页能解析吗？**
能，但仅精准解析 API 支持（需 Token），且自动使用 MinerU-HTML 模型。注意服务端抓不到被墙的 URL。

**Q：怎么批量解析？**
用 `mineru_batch_parse`，把文件路径/URL 列成列表即可，自动分批（本地 ≤50/批、URL ≤200/批、单次 ≤1000）。

**Q：Agent 轻量解析和精准解析结果有什么差别？**
轻量解析只出 Markdown；精准解析额外产出 `content_list.json`、`layout.json`、`model.json`、内嵌图片，还可加导出 docx/html/latex，且支持表格/公式识别参数。

## 开发与发布

本包**无构建步骤**：`lib/` 为可直接加载的 ESM，`lib/client.js` 为打包形态的浏览器 bundle。

```bash
node --check lib/*.js      # 语法检查
npm pack                   # 打包本地 tgz
```

新版本发布请严格按 [RELEASE.md](RELEASE.md) 清单执行（升版本号 → 更新 CHANGELOG 与双语 README → 打包验证 → 打 tag 推送 → `npm publish`），完整开发循环见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 贡献

欢迎 Issue 与 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。报告问题时请**勿粘贴 MinerU Token**。

## 许可

[MIT](LICENSE)。MinerU 由 [OpenDataLab](https://opendatalab.com) 提供，其官方文档（[API 文档](https://mineru.net/apiManage/docs)、[限流策略](https://mineru.net/apiManage/limit)）为权威依据。
