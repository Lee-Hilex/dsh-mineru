[English](README.md) · [简体中文](README.zh.md) · [更新日志](CHANGELOG.md) · [发布 SOP](RELEASE.md)

# 贡献指南 (Contributing)

欢迎提交 Issue 与 Pull Request。开始前请阅读：

- **Bug 报告**：在 [Issues](https://github.com/Lee-Hilex/dsh-mineru/issues) 中描述复现步骤、DSH 版本（`dsh --version`）、插件版本与相关日志；请勿在 Issue 中贴出 MinerU Token。
- **功能建议**：说明使用场景与期望行为，优先讨论再实现。
- **PR**：基于 `main` 分支，保持 `lib/` 下为可直接加载的 ESM 与打包形态的 `lib/client.js`；提交前运行 `node --check lib/*.js` 并在本地 profile 安装验证（见 README）。

## 本地开发循环

```
npm pack --pack-destination <目录>   # 打包 tgz
dsh plugin --profile web add <目录>/dsh-mineru-<version>.tgz   # 安装进 profile
# 重启 web profile 后验证; 修改代码后需重新打包并升版本号再安装
```

Web profile 重启可复用 `D:\Users\Lee\Desktop\dsh\.dsh-restart\restart.ps1`（杀 3080 端口旧进程并重启）。

注意：本地路径直装（pnpm link）会使 @deepseek-ai 依赖解析脱离 profile，请用 tgz 安装。

## 提交规范

- 提交信息格式：`<type>: <描述>[, 版本 X.Y.Z]`，`type` 取 `feat` / `fix` / `docs` / `refactor` / `chore`。
- 文档变更（README / CHANGELOG / CONTRIBUTING / RELEASE）与代码变更**必须同一次提交**，不要分开发。

## 发布流程

新版本发布请严格按 [RELEASE.md](RELEASE.md) 清单执行：升版本号（唯一来源 `package.json`）→ 更新 CHANGELOG 与双语 README → `npm pack` → 本地验证 → 打 tag 推送 → `npm publish`。
