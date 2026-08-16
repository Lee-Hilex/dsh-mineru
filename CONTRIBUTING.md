[English](README.md) · [简体中文](README.zh.md)

# 贡献指南 (Contributing)

欢迎提交 Issue 与 Pull Request. 开始前请阅读:

- Bug 报告: 在 [Issues](https://github.com/Lee-Hilex/dsh-mineru/issues) 中描述复现步骤、DSH 版本 (`dsh --version`)、插件版本与相关日志; 请勿在 Issue 中贴出 MinerU Token. 
- 功能建议: 说明使用场景与期望行为, 优先讨论再实现.
- PR: 基于 `main` 分支, 保持 `lib/` 下为可直接加载的 ESM 与打包形态的 `lib/client.js`; 提交前运行 `node --check lib/*.js` 并在本地 profile 安装验证 (见 README).

## 本地开发循环

```
npm pack --pack-destination <目录>   # 打包 tgz
dsh plugin --profile web add <目录>/dsh-mineru-<version>.tgz   # 安装进 profile
# 重启 web profile 后验证; 修改代码后需重新打包并升版本号再安装
```

注意: 本地路径直装 (pnpm link) 会使 @deepseek-ai 依赖解析脱离 profile, 请用 tgz 安装.
