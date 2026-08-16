# dsh-mineru

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![dsh](https://img.shields.io/badge/DeepSeek%20Harness-0.1.0--rc.6%2B-4d6bfe)](https://github.com/deepseek-ai/deepseek-harness) [![MinerU](https://img.shields.io/badge/MinerU-API-4d6bfe)](https://mineru.net)

> 🏠 仓库: <https://github.com/Lee-Hilex/dsh-mineru> · 📦 npm: `dsh-mineru`

给 DeepSeek Harness (dsh) 提供基于 [MinerU](https://mineru.net) 的多模态全格式文档解析能力：PDF、Word、PPT、Excel、HTML、图片 → 结构化 Markdown。**填写 MinerU Token 走 🎯 精准解析 API；Token 留空走 ⚡ Agent 轻量解析 API（免登录，IP 限频）。**

## 安装

前置：DeepSeek Harness `0.1.0-rc.6`（或兼容的 `0.1.x`）、`pnpm` 可用。

```
dsh plugin --profile web add <本包路径或 npm 名>
dsh plugin --profile headless add <本包路径或 npm 名>
```

重启 Web profile 后，在 **设置 → 插件 → MinerU 解析** 中配置 Token 与解析选项；在会话中输入 `/mineru-tools` 或让 Agent 调用 `skill` 工具加载 `mineru-tools` 技能。Headless 与 Web 共用同一套工具语义。

**拖拽上传**：直接把 PDF/Word/PPT/Excel/HTML/图片拖入聊天窗口即可——文件会先保存到当前会话工作区（`<workspace>/.dsh-mineru/uploads/`），随后自动向会话发送解析请求（文本引用路径）。这条路完全绕开"模型图片附件"通道，因此纯文本模型也能处理图片/文档；粘贴文档（非图片）同样生效。

## 两种 API 模式

| 维度 | 🎯 精准解析 API（需 Token） | ⚡ Agent 轻量解析 API（免 Token） |
| --- | --- | --- |
| 接口 | `/api/v4/extract/task`、`/api/v4/file-urls/batch`、`/api/v4/extract/task/batch` | `/api/v1/agent/parse/url`、`/api/v1/agent/parse/file` |
| 模型 | `pipeline` / `vlm`（默认）/ `MinerU-HTML` | 固定 pipeline 轻量模型 |
| 限制 | ≤200MB、≤200 页 | ≤10MB、≤20 页 |
| 批量 | ✅（URL ≤200/批，本地上传 ≤50/批） | ❌ 单文件 |
| 输出 | Zip：`full.md` + `*_content_list.json` + `layout.json` + 图片（可加 docx/html/latex） | 仅 Markdown |

模式解析：`mode=auto`（默认）按 Token 是否配置自动选择；`mode=precision` 强制精准解析（无 Token 直接报错）；`mode=agent` 强制轻量解析。HTML 文件仅精准解析支持，并自动强制 `MinerU-HTML` 模型。

## 工具

| 工具 | 说明 |
| --- | --- |
| `mineru_activate` | 引导工具（progressive 模式全局可见）：一次调用解锁其余工具，之后对本会话隐藏 |
| `mineru_parse` | 解析单个文档：工作区文件路径或 http(s) URL；签名上传、异步轮询、结果落地为 Artifact |
| `mineru_batch_parse` | 精准解析批量解析：本地路径与 URL 混合列表，自动分组提交，逐项报告成败 |
| `mineru_task` | 查询 / 收集已提交任务（超时后用 taskId 恢复，无需重复提交） |

所有解析结果写入 `<workspace>/.dsh-mineru/artifacts/<run>/`：精准解析为完整解包的 Zip（`full.md` 等），Agent 模式为 `full.md`；另有 `run.json` 元数据。工具结果包含限长的 Markdown 预览、任务 ID、耗时与 Artifact 列表（含签名预览链接）。Web 界面的工具卡片可直接打开/预览文件；Headless 直接复用列表中的绝对路径。

## 配置

配置分三层：schema 默认值 ← 组合层（profile patch 中的 `mineru` 行 config）← 用户设置（Web 设置卡片写入 `settings.yaml`）。

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

- **设置 → 插件 → MinerU 解析**：基本区（Token 只写、模式、模型、语言、识别开关、额外格式）+ 可折叠的 **高级设置**（超时/限速/限额、API 地址、凭据引用名、Artifact 根目录名）。每个操作都有即时反馈：保存/重新加载/测试按钮显示忙碌状态与结果消息；保存带修订冲突检测（409 → 重新加载后重试）；`测试 Token` 提交官方一页示例 PDF 验证密钥（约消耗 1 页额度）；`测试 Agent API` 验证免登录通道（受 IP 限频）。
- **工具卡片**：`mineru_parse` / `mineru_batch_parse` / `mineru_task` 的结果以专属卡片呈现：模式徽章、耗时、任务 ID、Artifact 列表（点击打开 / 链接预览）、限长预览、逐项批量结果。

## 安全模型

- 输入路径以会话工作区为根解析；ZIP 解包拒绝绝对路径、`..` 穿越、加密与 ZIP64，并带数量/体积上限；
- Artifact 只写入 `<workspace>/.dsh-mineru`，预览 URL 为 HMAC 签名 + 过期时间，每次读取重新校验；
- Web 路由仅接受同源请求；HTML/SVG 等 Artifact 以附件方式下发（`nosniff`）；
- 所有网络请求可被工具取消信号中止（会话取消/超时即停止上传、轮询与下载）。

## 开发

本包不依赖构建步骤：`lib/` 为可直接加载的 ESM，`lib/client.js` 为打包形态的浏览器 bundle（`dsh.client` → `exports["./client"]`）。

```
node --check lib/*.js      # 语法检查
```

## 发布

```
npm pack                       # 本地打包验证
npm publish                     # 发布到 npm (需先 npm login)
dsh plugin --profile web add dsh-mineru   # 用户安装 (发布后)
```

安装本地开发版本请用 tgz (见 [CONTRIBUTING.md](CONTRIBUTING.md)): `dsh plugin --profile web add <路径>/dsh-mineru-<version>.tgz`.

## 贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md). Issue 与 PR 均欢迎; 报告问题时请勿贴出 MinerU Token.

## 许可

MIT。MinerU API 由 OpenDataLab 提供，其限流策略以官方文档为准（提交 50 个文件/分钟、查询 1000 次/分钟、5000 个文件/天，官方保留动态调整权利）。
