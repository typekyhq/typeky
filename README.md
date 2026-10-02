# Typeky

A lightweight site builder for **personal blogs, business websites and niche sites**.

Deploy to **your own Cloudflare account** with **$0 monthly cost**. Content comes in three types — **pages, posts and products**. **Theme templates can be edited right in the admin panel and take effect immediately.**

> **Status: early development.** This repository is a working skeleton; the product is **not yet usable**.
> Progress lives in the commit log; each milestone is recorded in the [CHANGELOG](CHANGELOG.md).

**English** | [简体中文](README.zh-CN.md)

---

## Why another site builder

Every existing option has a sharp edge:

| Option | Problem |
| :---- | :---- |
| WordPress | You maintain a server, a PHP runtime and a plugin tree that keeps sprouting security patches |
| Wix / Squarespace | Monthly fees, and **you cannot touch the underlying templates** — the platform owns your site's structure |
| Hugo / Astro and friends | Fast and cheap, but **too technical for non-developers**: changing a layout means editing code |
| Notion-style tools | Pleasant to write in, but **no real SEO and no theme system** — they cannot host a serious website |

Typeky aims at the intersection of those three: **serverless hosting cost + genuinely editable templates + SEO out of the box**.

## Who it is for

- **Personal blogs / independent writers** — no hosting bill, but still able to reshape the layout
- **Business sites / studios** — get online quickly, showcase products and services, stay able to edit it later yourself
- **Niche site operators** — near-zero marginal cost, reusable across many sites, portable SEO assets

## Planned capabilities

| Capability | Description |
| :---- | :---- |
| Three content types | Pages, posts, and products (showcase-only: gallery, specs, price label, outbound CTA) |
| Block editor | Paragraph, heading, list, quote, code, image, video, divider, call-to-action. Stores structured JSON, never dirty HTML |
| **Online theme editing** | Edit `templates/*`, `snippets/*` and `layouts/*` in the admin panel; server-side validation with error line numbers; draft preview; one-click reset to default |
| Media library | Direct-to-object-storage upload, grid browsing, search, reference checking |
| SEO | Slugs with 301 redirects, canonical URLs, `sitemap.xml`, `robots.txt`, OpenGraph, JSON-LD |
| Deployment | One-click deploy to an empty Cloudflare account. **Your data stays in your own account** |

## How $0 works

The site runs entirely on Cloudflare's free tier: Workers for rendering, D1 for structured data, R2 for media, KV for cache and sessions. A personal blog or a business site normally stays far below the free limits. All you need is your own Cloudflare account.

## Stack

TypeScript · Cloudflare Workers · [Hono](https://hono.dev) · [LiquidJS](https://liquidjs.com) · React + Vite + Tailwind CSS + [shadcn/ui](https://ui.shadcn.com) · [Tiptap](https://tiptap.dev) · D1 / R2 / KV

**A deliberate split.** The customer-facing site uses **no frontend framework** — server-rendered Liquid only. That buys SEO, cacheable static output, and theme templates that are readable by non-developers. Frontend frameworks and a component library are confined to the **admin panel**, with strictly isolated build outputs. See [CONTRIBUTING](CONTRIBUTING.md#2-stack-decided-do-not-substitute) for the reasoning.

## Quick start

> ⚠️ Not usable yet. The steps below are the intended flow; this section will be replaced with a verified, copy-pasteable guide once the renderer is done.

```bash
git clone <repo>
pnpm install
pnpm --filter @typeky/site exec wrangler d1 create typeky
pnpm --filter @typeky/site exec wrangler r2 bucket create typeky-media
pnpm --filter @typeky/site exec wrangler kv namespace create CACHE
pnpm --filter @typeky/site deploy
```

## Local development

```bash
pnpm install          # install dependencies (also enables the commit hooks)
pnpm dev              # start the site Worker (wrangler dev)
pnpm dev:admin        # start the admin SPA

pnpm check            # typecheck + tests + asset boundary assertions
```

Read [CONTRIBUTING](CONTRIBUTING.md) before opening a pull request — it holds the architecture red lines and the commit conventions.

## Roadmap

| Milestone | Scope | Status |
| :---- | :---- | :---- |
| M1 | Monorepo skeleton, data model, Liquid runtime | done |
| M2 | Admin panel and authentication | in progress |
| M3 | Block editor | planned |
| M4 | CRUD for the three content types, media library | planned |
| M5 | **Online theme editing** | planned |
| M6 | Site rendering and SEO | planned |
| M7 | White-label licensing, one-click deploy, MVP release | planned |

## License

**AGPLv3** — see [LICENSE](LICENSE).

Free to use, modify and self-host, but **network service providers must release their modifications under AGPLv3**. This closes the door on wrapping the open core into a proprietary hosted service.

In exchange, free usage requires keeping the `Powered by Typeky` footer attribution and a working backlink. If you are delivering the site under your own brand, a **white-label license** removes all official attribution (pricing on the website).

## Contributing

Issues and pull requests are welcome. Before submitting:

- Read the architecture red lines and commit conventions in [CONTRIBUTING](CONTRIBUTING.md)
- Run `pnpm check`
- Follow the `<type>(<scope>): <subject>` commit format (a hook enforces it)

External pull requests require signing a Contributor License Agreement (CLA) so the project can keep offering both the AGPLv3 build and the commercial white-label license. See [CONTRIBUTING §9](CONTRIBUTING.md#9-contributor-license-agreement-cla).

## Security

Please **do not** open a public issue for vulnerabilities. See [SECURITY](SECURITY.md) for the private reporting channel.
