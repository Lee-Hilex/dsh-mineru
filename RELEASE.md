# 发布 SOP（Release Checklist）

发布 dsh-mineru 新版本的完整清单。**每次发布都必须逐项核对**，尤其是第 4、5 步——代码与文档必须同步发布，不允许只改代码。

## 版本号规则

- 遵循 [SemVer](https://semver.org/lang/zh-CN/)：`major.minor.patch`。
- **唯一来源：`package.json` 的 `version` 字段**。`lib/` 内的 `'0.1.0'` 仅为 fallback，不要修改。
- Git tag 格式：`v<version>`（如 `v0.1.8`）。

## 发布清单

### 1. 代码准备（用户 / dsh 侧）

- [ ] 功能/修复已完成，`node --check lib/*.js` 全部通过
- [ ] 版本号已升（`package.json` → `npm version patch|minor|major` 或手动改）

### 2. 文档同步（本会话职责）

- [ ] `CHANGELOG.md` 增加 `[Unreleased]` 条目（保持 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 风格）
- [ ] `README.md`（英文）+ `README.zh.md`（简体中文）**同步更新**：
  - [ ] 版本徽章 `version-X.Y.Z-blue`
  - [ ] 功能特点列表（新增/变更/移除的描述）
  - [ ] 配置示例、工具表、限流数值等任何与代码相关的描述
  - [ ] 安装示例（若涉及）
- [ ] 中英两版描述保持一致（术语可不同，事实必须相同）

### 3. 本地打包验证

```powershell
# 在仓库目录执行：
npm pack --pack-destination D:\Users\Lee\Desktop\dsh
```

- [ ] 生成 `dsh-mineru-<version>.tgz` 到 `D:\Users\Lee\Desktop\dsh\`
- [ ] tgz 内容核对：`lib/`、`cordis.patch.yml`、`README.md`、`README.zh.md`、`CHANGELOG.md`、`CONTRIBUTING.md`、`LICENSE`、`package.json`（`npm pack --dry-run` 可预览清单）
- [ ] 本地安装验证（可选但推荐）：

```powershell
dsh plugin --profile web add D:\Users\Lee\Desktop\dsh\dsh-mineru-<version>.tgz
# 重启 web profile 后冒烟：mineru_activate → mineru_parse
```

### 4. 提交与打 tag（Git）

```powershell
git add -A
git commit -m "docs: release v<version> (CHANGELOG + bilingual README sync)"
git tag v<version>
git push origin main --tags
```

- [ ] 提交包含**代码 + 全部文档**（用 `git diff --stat` 检查三个文件：`README.md`、`README.zh.md`、`CHANGELOG.md` 都在）
- [ ] tag 已推送（`git ls-remote --tags origin` 可验证）

### 5. 发布到 npm

```powershell
npm whoami        # 未登录先执行 npm login
npm publish
```

- [ ] 发布前已 `npm login`（一次登录长期有效）
- [ ] 发布后验证：`npm view dsh-mineru version` 返回最新版本号
- [ ] 若发布失败（如包名被占），**不要硬推**——与用户确认是否改包名，并同步修改 README / package.json / 记忆

### 6. GitHub 仓库元数据（可选，一次性）

- [ ] repo `description` 与 `topics` 保持最新（`api.github.com` PATCH 或 Settings 手动设置）

## 快速命令（一条龙）

```powershell
cd D:\Users\Lee\Desktop\dsh\dsh-mineru
node --check lib/*.js
npm pack --pack-destination D:\Users\Lee\Desktop\dsh
git add -A && git commit -m "docs: 发布 v<version>"
git tag v<version> && git push origin main --tags
npm publish
```

## 注意事项

- **本地路径安装必须用 tgz**：pnpm `link:` 安装会使 `@deepseek-ai` 依赖解析脱离 profile。
- **不要在 Issue 里贴 MinerU Token**。
- npm 包名与仓库名一致（`dsh-mineru`），发布前确认该包名未被占用。
- 完整贡献规范见 [CONTRIBUTING.md](CONTRIBUTING.md)。
