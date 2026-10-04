# Typeky

面向**个人博客、企业网站与垂直 niche 站**的轻量建站平台。

把站点部署到**你自己的 Cloudflare 账号**，月成本从 **$0** 起。内容分**页面 / 文章 / 产品**三类，**主题模板可以在后台直接编辑，改完即时生效**。

> **状态：v0.1.0 —— 早期版本，但前后台已能端到端跑通。** 后台与发布出来的站点都能跑在你自己的 Cloudflare 账号上：内容、媒体、在线改主题、分类词条，以及渲染出的前台页面。**尚未**在空白 Cloudflare 账号上完整走一遍，所以在那之前，部署仍算未完成。
> 进度可以直接看提交历史；每个里程碑登记在 [CHANGELOG](CHANGELOG.md)。

[English](README.md) | **简体中文**

---

## 为什么又做一个建站工具

现有选择各有硬伤：

| 选项 | 问题 |
| :---- | :---- |
| WordPress | 要维护服务器、PHP 环境与插件树，安全补丁没完没了 |
| Wix / Squarespace | 月费不低，而且**改不了底层模板**——站点的结构属于平台 |
| Hugo / Astro 等静态生成器 | 快、便宜，但**对非开发者门槛太高**：改一次版式就要动代码 |
| Notion 类工具 | 写起来舒服，但**没有真正的 SEO 与主题体系**，撑不起一个正经站点 |

Typeky 想做这三者的交集：**零服务器的托管成本 + 真正可编辑的模板 + 开箱的 SEO**。

## 目标用户

- **个人博客 / 独立作者** —— 不想付主机月费，又希望能自己调版式
- **企业官网 / 工作室** —— 快速上线，能展示产品与服务，后续能自己改
- **niche 站长** —— 极低边际成本、多站复用、SEO 资产可迁移

## 能力

| 能力 | 说明 |
| :---- | :---- |
| 三种内容类型 | 页面、文章、产品（展示型：图集、规格、价格标签、外链按钮） |
| 块级编辑器 | 段落 / 标题 / 列表 / 引用 / 代码 / 图片 / 视频 / 分隔线 / 行动号召；存结构化 JSON，不产生脏 HTML |
| **主题模板在线编辑** | 后台直接改 `templates/*`、`snippets/*`、`layouts/*`；服务端校验并定位错误行；草稿预览；一键还原默认；可上传主题文件夹 |
| 媒体库 | 经 Worker 上传到 R2，网格浏览、检索、引用检查、替代文本可改 |
| 分类词条 | 可嵌套的词条表，挂到文章与产品，每个词条有 `/category/{slug}` 归档页 |
| SEO | canonical、逐文档 meta 与 OpenGraph、`sitemap.xml`、`robots.txt`、JSON-LD |
| 多语言 | 后台内置九种语言，阿拉伯语从右到左排版 |
| 部署 | 一键部署到空白 Cloudflare 账号。**数据完全在你自己的账号里** |

## $0 是怎么做到的

站点完全跑在 Cloudflare 免费额度内：Workers 负责渲染，D1 存结构化数据，R2 存媒体，KV 做缓存与会话。个人博客与企业站通常远低于免费上限。你只需要一个自己的 Cloudflare 账号。

## 技术栈

TypeScript · Cloudflare Workers · [Hono](https://hono.dev) · [LiquidJS](https://liquidjs.com) · React + Vite + Tailwind CSS + [shadcn/ui](https://ui.shadcn.com) · [Tiptap](https://tiptap.dev) · D1 / R2 / KV

**一个刻意的拆分。** 面向买家的公开站点**不使用任何前端框架**，只做服务端渲染的 Liquid。这换来 SEO、可缓存的静态输出，以及一份非开发者也能读懂的主题模板。前端框架与组件库只用于**后台管理端**，两侧构建产物严格隔离。理由见 [CONTRIBUTING](CONTRIBUTING.md#2-stack-decided-do-not-substitute)。

## 快速开始

Typeky 跑在你自己的 Cloudflare 账号上。整套部署大约十分钟，免费额度就够；可复制即用的完整步骤（含最小权限令牌清单与常见坑）见 [**部署 Typeky**](docs/quick-start.md)。

```bash
git clone https://github.com/typekyhq/typeky.git
cd typeky
pnpm install

pnpm --filter @typeky/site exec wrangler d1 create typeky
pnpm --filter @typeky/site exec wrangler r2 bucket create typeky-media
pnpm --filter @typeky/site exec wrangler kv namespace create CACHE
# 把两个 id 填进 apps/site/wrangler.jsonc

pnpm db:migrate:remote
pnpm deploy              # 先部署再设密钥：原因见指南
pnpm admin:password      # 生成哈希，再用 `wrangler secret put` 存进去
```

站点在填好名字之前一直返回 503：在 `/admin/` 登录，打开**设置**，保存。[指南](docs/quick-start.md)解释了原因。

不想用账号的话，可以[在本地跑](docs/README.md#running-it-locally)——数据库、对象存储与缓存都跑在 Wrangler 里。

## 本地开发

```bash
pnpm install          # 安装依赖（同时自动启用提交钩子）
pnpm dev              # 起站点 Worker（wrangler dev）
pnpm dev:admin        # 起后台 SPA

pnpm check            # 类型检查 + 测试 + 资产边界断言
```

提 PR 前请读 [CONTRIBUTING](CONTRIBUTING.md)——里面有架构红线与提交规范。

## 路线图

| 里程碑 | 内容 | 状态 |
| :---- | :---- | :---- |
| M1 | 工程骨架、数据模型、Liquid 运行时 | 已完成 |
| M2 | 后台管理端与登录 | 已完成 |
| M3 | 块编辑器 | 已完成 |
| M4 | 三种内容类型的增删改查与媒体库 | 已完成 |
| M5 | **主题模板在线编辑** | 已完成 |
| M6 | 前台渲染与 SEO | 已完成 |
| M7 | 白标授权、一键部署、MVP 发布 | 已完成 |

M7 之后追加的工作——分类词条、后台多语言、主题上传与删除、媒体替代文本可编辑、品牌配色、词条归档页——按提出顺序陆续交付，登记在 [CHANGELOG](CHANGELOG.md)。

## 许可

**AGPLv3** —— 详见 [LICENSE](LICENSE)。

使用、修改、自部署都免费，但**网络服务提供者必须按 AGPLv3 开放修改后的源码**。这条封死了"把开源核心包装成专有云服务"的路径。

作为交换，免费使用需要保留页脚的 `Powered by Typeky` 署名与有效反向链接。如果你要把站点作为自己的品牌交付，可以购买**白标授权**移除全部官方署名（价格见官网）。

## 参与贡献

欢迎 issue 与 PR。提交前请确认：

- 读过 [CONTRIBUTING](CONTRIBUTING.md) 的架构红线与提交规范
- `pnpm check` 通过
- 提交信息符合 `<type>(<scope>): <subject>` 格式（钩子会自动校验）

外部 PR 需要签署贡献者协议（CLA），这样项目才能同时提供 AGPLv3 版本与商业白标授权。见 [CONTRIBUTING §9](CONTRIBUTING.md#9-contributor-license-agreement-cla)。

## 安全

漏洞请**不要**开公开 issue。报告渠道见 [SECURITY](SECURITY.md)。
