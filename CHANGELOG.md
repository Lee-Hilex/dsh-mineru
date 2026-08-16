# Changelog

All notable changes to **dsh-mineru** are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/), and versioning follows [Semantic Versioning](https://semver.org/lang/zh-CN/). 版本号唯一来源是 `package.json`。

## [Unreleased]

- 无（当前为最新发布版本 0.1.7）

## [0.1.7] - 2026-08-16

### Fixed

- 拖拽上传改为**填入输入框草稿（不自动发送）**：文件落到会话工作区后，其路径填入输入框，由用户补充需求后自行发送，完全绕开纯文本模型会拒绝的原生图片附件通道。
- 清除拖拽残留的全屏遮罩（拖拽结束或取消后遮罩层不再残留）。

## [0.1.6] - 2026-08-16

### Docs

- 双语 README：`README.md`（默认英文）+ `README.zh.md`（简体中文）。
- 统一仓库 / npm / MinerU 链接与介绍结构。

## [0.1.5] - 2026-08-16

### Fixed

- P3–P8 自检问题批量修复：
  - `presentCall` 未定义（工具调用上下文缺失时崩溃）；
  - 批量解析自动分批（每批 ≤50 文件 / ≤200 URL，单次 ≤1000）；
  - 错误码映射补齐（A0202/A0211、-60005/-60006、-30001~-30003、-60018 等全部映射为可操作提示）；
  - ZIP 解包 CRC 校验与截断防护；
  - 上传同名文件冲突处理；
  - 版本号改为单一来源（`package.json`）。

## [0.1.4] - 2026-08-16

### Fixed

- 工具结果序列化失败（`value is not lossless JSON`）；
- `mineru-tools` skill 加载失败（`source must be a string`）。

## [0.1.2] - 2026-08-16

### Added

- 首个可用版本：MinerU 多模态文档解析插件 for DeepSeek Harness。
  - 双 API 模式：精准解析 API（需 Token）/ Agent 轻量解析 API（免 Token）；
  - 工具：`mineru_parse`、`mineru_batch_parse`、`mineru_task`、`mineru_activate`（progressive 引导）与 `mineru-tools` 技能；
  - 限流感知（令牌桶 + 429 退避 + 每日限额）；
  - Artifact 落地与 Web 界面（设置卡片、工具结果卡片、HMAC 签名预览）。

[0.1.7]: https://github.com/Lee-Hilex/dsh-mineru/releases/tag/v0.1.7
[0.1.6]: https://github.com/Lee-Hilex/dsh-mineru/releases/tag/v0.1.6
[0.1.5]: https://github.com/Lee-Hilex/dsh-mineru/releases/tag/v0.1.5
[0.1.4]: https://github.com/Lee-Hilex/dsh-mineru/releases/tag/v0.1.4
[0.1.2]: https://github.com/Lee-Hilex/dsh-mineru/releases/tag/v0.1.2
