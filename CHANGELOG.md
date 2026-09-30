# Changelog

本文件记录**对使用者可见的变更**。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

更新时机：**每个里程碑**（见 README 的路线图）打标签时同步更新本文件。日常提交不必修改这里——提交历史本身就是细粒度进度（规范见 [CONTRIBUTING.md](CONTRIBUTING.md) §5）。

## [Unreleased]

### Added

- 工程骨架：pnpm monorepo，含 `apps/site`（站点 Worker）、`apps/admin`（后台 SPA）与 `packages/*` 共享包
- 资产边界断言脚本 `pnpm check:boundaries`：确保站点侧不引入前端框架、站点 Worker 不引用编辑器包
- 提交信息规范与 Git 钩子（`.githooks/commit-msg` 校验格式、`.githooks/pre-push` 做推送前把关）
- 公开文档：[README](README.md)、[CONTRIBUTING.md](CONTRIBUTING.md)、[SECURITY](SECURITY.md)、本文件、[LICENSE](LICENSE)

### Notes

- **本项目尚不可用于实际建站**。当前只有工程骨架与文档，功能开发尚未开始。
- 站点 Worker 目前仅提供一个健康检查端点，用于验证本地开发与构建链路。
