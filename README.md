# Typeky

面向**个人博客、企业网站与垂直 niche 站**的轻量建站平台。

把站点部署到**你自己的 Cloudflare 账号**，月成本从 **$0** 起；内容分**页面 / 文章 / 产品**三类；**主题模板可以在后台直接编辑，改完即时生效**。

> **状态：开发中（v1 MVP）**。当前仓库是刚打好的工程骨架，**还不能用于实际建站**。
> 进度可以直接看提交历史；每个里程碑会在 [CHANGELOG](CHANGELOG.md) 中登记。

---

## 为什么需要它

现有选择各有硬伤：

| 现状 | 问题 |
| :---- | :---- |
| WordPress | 要维护服务器、PHP 环境与插件更新，安全补丁不断 |
| Wix / Squarespace | 月费不低，且**改不了底层模板**，被平台绑死 |
| Hugo / Astro 等静态生成器 | 快、便宜，但**对非技术用户门槛太高**，改一次版式就要动代码 |
| Notion 类工具 | 写东西舒服，但**没有真正的 SEO 与主题体系**，做不了正经站点 |

Typeky 想做的是这三者的交集：**零服务器的托管成本 + 真正可编辑的模板 + 开箱的 SEO**。

## 目标用户

- **个人博客 / 独立作者** —— 不想付主机月费，又希望能自己调版式
- **企业官网 / 工作室** —— 快速上线，产品与服务能展示，后续自己能改
- **niche 站长** —— 极低边际成本、多站复制、SEO 资产可迁移

## 规划中的能力

| 能力 | 说明 |
| :---- | :---- |
| 三种内容类型 | 页面、文章、产品（展示型：图集、规格、价格标签、外链按钮） |
| 块级编辑器 | 段落 / 标题 / 列表 / 引用 / 代码 / 图片 / 视频 / 分隔线 / 行动号召；输出结构化 JSON 而非脏 HTML |
| **主题模板在线编辑** | 后台直接改 `templates/*`、`snippets/*`、`layouts/*`；保存前服务端校验并定位错误行；支持草稿预览与一键还原默认 |
| 媒体库 | 直传对象存储，网格浏览、检索、引用检查 |
| SEO | Slug 与 301、canonical、`sitemap.xml`、`robots.txt`、OpenGraph、JSON-LD |
| 部署 | 一键部署到空白 Cloudflare 账号；**数据完全在你自己的账号里** |

**技术上怎么做到 $0**：站点运行在 Cloudflare Workers，数据在 D1，媒体在 R2，缓存与会话在 KV —— 全部走 Cloudflare 的免费额度（个人博客与企业站通常远用不到上限）。你只需要一个自己的 Cloudflare 账号。

## 技术栈

TypeScript · Cloudflare Workers · [Hono](https://hono.dev) · [LiquidJS](https://liquidjs.com) · React + Vite + Tailwind CSS + [shadcn/ui](https://ui.shadcn.com) · [Tiptap](https://tiptap.dev) · D1 / R2 / KV

**设计取舍**：面向买家的**公开站点不用任何前端框架**，只做服务端渲染 —— 这是为了 SEO、可缓存的静态输出，以及让主题模板保持为一个普通人也能读懂的格式（Liquid）。前端框架与组件库只用在**后台管理端**，两侧代码与产物严格隔离。

## 快速开始

> ⚠️ 尚未可用。以下为计划中的流程，M6 完成后本文档会替换为经过实跑验证的步骤。

```bash
# 计划中的形态（当前还不能用）
git clone <repo>
pnpm install
pnpm --filter @typeky/site exec wrangler d1 create typeky
pnpm --filter @typeky/site exec wrangler r2 bucket create typeky-media
pnpm --filter @typeky/site exec wrangler kv namespace create CACHE
pnpm --filter @typeky/site deploy
```

## 本地开发

```bash
pnpm install          # 安装依赖（同时自动启用提交钩子）
pnpm dev              # 起站点 Worker（wrangler dev）
pnpm dev:admin        # 起后台 SPA

pnpm check            # 类型检查 + 测试 + 资产边界断言，提交前跑这个
```

贡献前请读 [CONTRIBUTING.md](CONTRIBUTING.md)——里面有架构红线、代码约定与提交规范。

## 路线图

| 阶段 | 内容 | 状态 |
| :---- | :---- | :---- |
| M1 | 工程骨架、数据模型、Liquid 运行时 | 进行中 |
| M2 | 后台管理端与登录 | 待开始 |
| M3 | 块编辑器 | 待开始 |
| M4 | 三种内容类型的增删改查与媒体库 | 待开始 |
| M5 | **主题模板在线编辑** | 待开始 |
| M6 | 前台渲染与 SEO | 待开始 |
| M7 | 白标授权、一键部署、MVP 发布 | 待开始 |

## 许可

**AGPLv3** —— 详见 [LICENSE](LICENSE)。

使用、修改、自部署都免费，但**网络服务提供者必须按 AGPLv3 开放修改后的源码**。这条封死了"把开源核心包装成商业云服务"的路径。

作为交换，免费使用需要保留页脚的 `Powered by Typeky` 署名与有效反向链接；如果你要把站点作为自己的品牌交付，可以购买**白标授权**移除全部官方署名（价格见官网）。

## 参与贡献

欢迎 issue 与 PR。提交前请确认：

- 读过 [CONTRIBUTING.md](CONTRIBUTING.md) 的架构红线与提交规范
- `pnpm check` 通过
- 提交信息符合 `<type>(<scope>): <subject>` 格式（钩子会自动校验）

外部 PR 需要签署贡献者协议（CLA），以保证项目可以继续维护双许可模式。相关文档将在 M7 补充。

---

## English Summary

**Typeky** is a lightweight site builder for personal blogs, business websites and niche sites.

Deploy to **your own Cloudflare account** with **$0 monthly cost**; content comes in three fixed types (pages, posts, products); **theme templates can be edited right in the admin panel and take effect immediately**.

Stack: TypeScript · Cloudflare Workers · Hono · LiquidJS · React + Vite + Tailwind + shadcn/ui · Tiptap · D1 / R2 / KV.

The customer-facing site deliberately uses **no frontend framework** — server-rendered Liquid only — for SEO, cacheable static output, and readable theme templates. Frameworks are confined to the admin SPA, with strictly isolated build outputs.

**Status: early development.** The repo is a working skeleton; the product is not yet usable. See the commit log and [CHANGELOG](CHANGELOG.md) for progress.

Licensed under **AGPLv3**. Free to use and self-host, but network service providers must release their modifications under AGPLv3. Free usage requires keeping the `Powered by Typeky` attribution; a white-label license removes it.
