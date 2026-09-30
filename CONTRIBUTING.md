# Contributing

感谢你考虑为 Typeky 做贡献。本文件是**工程规则的唯一事实来源**；提交前请至少读完[第 3 节（架构红线）](#3-架构红线code-review-一票否决)与[第 5 节（提交规范）](#5-提交规范)。

## 1. 项目一句话

面向**个人博客、企业网站与垂直 niche 站**的轻量建站平台：部署到**用户自己的 Cloudflare 账号**，月成本从 $0 起；内容分**页面 / 文章 / 产品**三类；**主题模板可在后台在线编辑，改完即时生效**。

阶段范围见 [README](README.md) 的路线图。**不在其中的能力请先开 issue 讨论，不要直接动手实现** —— 这个项目刻意保持小范围，避免功能膨胀。

## 2. 技术栈（已定，不要替换）

| 层 | 选型 |
| :---- | :---- |
| 语言 | TypeScript（`strict`，ESM only） |
| 站点运行时 | Cloudflare Workers（Hono + LiquidJS 服务端渲染） |
| 后台运行时 | 浏览器（React + Vite + Tailwind CSS + shadcn/ui，独立 SPA） |
| 块编辑器 | Tiptap + `@tiptap/react` |
| 数据库 | Cloudflare D1（SQLite）+ Drizzle |
| 对象存储 | R2（媒体资产与主题静态资源） |
| 缓存 / 会话 | KV + Cache API |
| 包管理 | pnpm workspace（monorepo） |

**为什么分两套渲染**：站点侧必须为 SEO、静态缓存与主题契约付出"无框架"的代价；后台侧没有这些约束，却集中了最高的 UI 复杂度。让两侧各自取最优，但**必须物理隔离** —— 这是很多约束的来源。

## 3. 架构红线（Code Review 一票否决）

### 3.1 边界

1. **站点侧**（`apps/site`、`packages/themes/**`、任何模板）引入前端框架（React / Vue / Svelte / Solid / Astro / Next / Nuxt / Remix）、SPA 或状态库，或使用 Hono JSX。
2. 站点构建产物中出现框架代码，或后台 SPA 被站点路由引用。
3. 站点 Worker `import` `@typeky/editor`（编辑器只属于后台）。
4. `packages/*` 中除 `@typeky/platform` 外，直接 `import` Cloudflare 绑定类型（`D1Database`、`R2Bucket`、`KVNamespace`）。
5. 在路由或 handler 里直接拼 SQL —— 所有数据访问必须经过 `@typeky/db` 的仓储方法。

### 3.2 内容与模板

6. 引入自定义内容模型（集合、动态字段、动态表单引擎）—— 内容类型固定为三种。
7. 允许后台创建**新**模板文件或上传整套主题包 —— 只允许编辑主题既有的模板。
8. 对用户可控内容使用 `| raw`，或在模板里手拼 `<script>` / JSON-LD。
9. 把宿主函数、类实例或带 `toValue()` 的对象放进渲染上下文（模板只允许消费纯 JSON 数据）。
10. 新增自定义 Liquid 标签 / 过滤器时不设限制就开放给可编辑模板。

### 3.3 依赖与运行

11. 引入 **GPL / AGPL 系**依赖 —— 其传染性会与项目的双许可模式冲突（见 §9）。永久排除的具体项见 §4。
12. 引入 Redis / Docker / Kubernetes / Nginx / Caddy。
13. 在单个请求内执行超过 1 秒的数据库事务，或一次性载入超过 50 MB 数据到内存。
14. 在请求路径中同步调用第三方 API（一律走队列或异步）。
15. 用 KV 承载会话之外的强一致判断（会话允许存 KV，其余读缓存必须可重建）。
16. 把模板源码存进 R2 再在渲染时多次读取 —— 模板走 D1 两级查找 + 记忆化。

## 4. 代码约定

**通用**

- TypeScript `strict`；只写 ESM；`verbatimModuleSyntax` 已开启，类型导入必须写 `import type`。
- 禁用 `any`（用 `unknown` + 收窄）；禁用 `@ts-ignore`（用 `@ts-expect-error` 并写明原因）。
- 优先具名导出；唯一例外是 Worker 的 `export default`。
- 文件名 kebab-case；变量/函数 camelCase；类型 PascalCase。
- 内部包互相引用一律用 workspace 协议：`"@typeky/core": "workspace:*"`。
- 每个包的公开入口是它的 `src/index.ts`；跨包只从入口导入。

**数据**

- 时间一律 **UTC ISO 8601 字符串**（`YYYY-MM-DDTHH:mm:ss.sssZ`）。
- 主键一律 **UUIDv7**，由应用层生成（`@typeky/core/id`），不依赖数据库函数。
- JSON 字段在 D1 中存 TEXT，读写必须经过 `@typeky/core/codec`。
- 产品价格目前是**文本标签**，不做金额计算。

**依赖**

- 新增依赖前先自问：标准库或已有依赖能否解决？三个包能写完的东西不要引入一个框架。
- 许可证白名单：**MIT / BSD-2 / BSD-3 / Apache-2.0 / ISC**。其他一律先开 issue 确认。
- 永久排除：TinyMCE（v7+ 转 GPLv2+，v8 自托管强制许可证密钥）、CKEditor 5（GPLv2 / 商业双授权）、任何 AGPL 依赖。

**注释与文案**

- 代码注释、内部 JSDoc 用**中文**（本项目的日常工作语言）。
- 面向用户的字符串（后台界面、错误提示、邮件模板）用**英文**，中文界面属后续需求。
- 注释解释**为什么**，不复述代码在做什么。

**安全**

- 环境变量与密钥绝不硬编码。本地用 `.dev.vars`（已忽略），生产用 `wrangler secret`。
- 提交前自检：有没有把密钥、`.dev.vars`、构建产物带进去？

## 5. 提交规范

> 提交历史是本公开仓库的**开发日志**。任何人都能通过它判断：项目是否在推进、改动方向是否可信、某次行为变更发生在哪一版。因此格式与粒度都是硬要求。

### 5.1 频率：一次「切片」一次提交

- **一次提交 = 一个切片**：一个**能自测通过**的最小增量（约 2 小时工作量）。
- 预期节奏：**每周 5~7 次提交**。
- 每个提交必须自洽：`pnpm check` 通过，不留半成品。
- **禁止攒批**。不要把几天的活攒成一次"大提交"——那会同时毁掉可读性、可回滚性和进度可见性。
- 里程碑打附注标签：`git tag -a v0.1.0 -m "..."`。

### 5.2 格式：Conventional Commits

```
<type>(<scope>): <subject>

<body>

<footer>
```

| 字段 | 规则 |
| :---- | :---- |
| `type` | `feat` `fix` `refactor` `perf` `test` `docs` `chore` `build` `ci` `revert` |
| `scope` | `site` `admin` `core` `db` `platform` `theme-kit` `themes` `api` `editor` `scripts` `repo` |
| `subject` | **英文** · 祈使句 · 小写开头 · 不加句号 · ≤ 72 字符 |
| `body` | 可选，说明**为什么**这么做（不复述改了什么） |
| `footer` | 可选：`BREAKING CHANGE:` / `Refs: #12` / `Closes: #12` |

破坏性变更在 type 后加 `!`，例如 `feat(core)!: change block json top-level shape`。

### 5.3 好与坏

```
✅ feat(db): add d1 schema for pages posts and products
✅ fix(theme-kit): stop caching parsed templates across revisions
✅ refactor(core): extract block serializer behind a single entry point

❌ 更新代码                       ← 无 type、无信息量
❌ feat: 加了数据库                ← subject 必须是英文
❌ feat(db): Added the schema.     ← 过去式 + 句号
❌ feat(db): add d1 schema for pages posts and products and media
                                   ← 超过 72 字符且混了多件事
```

### 5.4 强制手段

- `.githooks/commit-msg` 校验上述格式，不合规直接拒绝提交。
- `.githooks/pre-push` 运行类型检查与资产边界断言。
- 钩子通过 `core.hooksPath` 启用；根 `package.json` 的 `prepare` 会在安装依赖后自动配置，**新克隆无需手动设置**。
- 紧急情况可以 `git commit --no-verify`，但不要把不合规的提交推到远端。

### 5.5 分支与标签

- 默认**主干开发**：直接提交到 `main`，因为每个提交都要求自洽通过检查。
- 仅在两类情况开短分支：① 风险较高的重构；② 需要多天完成的特性。
- 标签用语义化版本：`v0.1.0` 为 MVP 首个可用版本，此后按里程碑递增。

## 6. 目录与职责

```
apps/
  site/           站点 Worker —— Hono + LiquidJS + D1/R2/KV；禁止任何前端框架
  admin/          后台 SPA —— React + Vite + Tailwind + shadcn/ui
packages/
  core/           逻辑模型、Block JSON 规范、UUIDv7、codec、零依赖 blockToHtml()
  db/             Drizzle schema（SQLite）与仓储 —— 数据访问的唯一入口
  platform/       StoragePort 定义与 Cloudflare 适配（D1 / R2 / KV / Cache）
  theme-kit/      Liquid 运行时、两级模板加载器、自定义过滤器
  themes/default/ 内置主题基线：layouts / templates / snippets / assets
  api/            admin JSON API 契约（Zod schema + 类型）
  design-tokens/  站点与后台共享的 Tailwind 设计变量
  editor/         块编辑器（Tiptap 封装 + Block JSON 映射）—— 仅后台可引用
scripts/          代码生成、模板编译、静态检查、资产边界断言
public/           构建产物输出根（theme / static / admin 三份，均已忽略）
```

**三条关键边界**

1. `blockToHtml()` 放在 `packages/core` 且**保持零依赖** —— 它是 HTML 的唯一产出点。
2. 任何 React / Tiptap 依赖只能出现在 `packages/editor` 与 `apps/admin`。
3. `apps/site` 不得引用 `@typeky/editor`；由 `pnpm check:boundaries` 断言。

## 7. 本地开发与验证

```bash
pnpm install             # 安装依赖（同时自动启用提交钩子）
pnpm dev                 # 本地起站点 Worker（wrangler dev）
pnpm dev:admin           # 本地起后台 SPA

pnpm typecheck           # 全部 workspace 包类型检查
pnpm test                # 单元测试（vitest）
pnpm check:boundaries    # 资产边界断言
pnpm check               # 以上三者一次跑完 —— 提交前的标准动作
```

**提交前的最低要求**：`pnpm check` 通过。

## 8. 文档

| 层级 | 位置 | 内容 |
| :---- | :---- | :---- |
| 用户文档 | [`docs/`](docs/) | 部署指南、使用手册、主题开发指南、FAQ |
| 贡献者文档 | 仓库根 | [README](README.md)、本文件、[CHANGELOG](CHANGELOG.md)、[SECURITY](SECURITY.md)、[LICENSE](LICENSE) |
| 维护者资料 | 不在本仓库 | 由维护者自行保管，不随仓库分发 |

规则：

- 公开文档不得出现内部经营数据、未发布的功能承诺、维护者的待办与优先级。
- 公开文档里的每条命令必须**实际跑过**，做到可复制即用。
- 中文为主；面向国际贡献者的部分补 `*.en.md`。

## 9. 贡献者协议（CLA）

外部 PR 需要签署贡献者协议，将贡献的版权授权给项目方 —— 这样项目才能同时以 AGPLv3 提供开源版本、并以商业许可提供白标授权。没有这一步，双许可模式在法律上无法成立。

签署流程会在正式发布前接入（自动化 CLA 校验），当前阶段提交 PR 时维护者会与你确认。

## 10. 报告问题

- **功能缺陷 / 功能建议**：开 issue，附上复现步骤或使用场景。
- **安全漏洞**：请**不要**开公开 issue，按 [SECURITY.md](SECURITY.md) 的渠道私下报告。
