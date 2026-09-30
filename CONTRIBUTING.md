# Contributing

Thanks for considering a contribution to Typeky. This file is the **single source of truth for engineering rules**. Before submitting, please read at least [section 3 (architecture red lines)](#3-architecture-red-lines-vetoed-in-review) and [section 5 (commit conventions)](#5-commit-conventions).

## 1. What this is

A lightweight site builder for **personal blogs, business websites and niche sites**: deploy to **your own Cloudflare account** with **$0 monthly cost**; content comes in three types — **pages, posts and products**; **theme templates can be edited right in the admin panel and take effect immediately**.

The current scope is in the [README](README.md#roadmap) roadmap. **Anything not on it should be discussed in an issue first — please do not implement it directly.** The project deliberately stays small to avoid feature sprawl.

## 2. Stack (decided, do not substitute)

| Layer | Choice |
| :---- | :---- |
| Language | TypeScript (`strict`, ESM only) |
| Site runtime | Cloudflare Workers (Hono + LiquidJS server-side rendering) |
| Admin runtime | Browser (React + Vite + Tailwind CSS + shadcn/ui, a separate SPA) |
| Block editor | Tiptap + `@tiptap/react` |
| Database | Cloudflare D1 (SQLite) + Drizzle |
| Object storage | R2 (media assets and theme static assets) |
| Cache / sessions | KV + Cache API |
| Package manager | pnpm workspace (monorepo) |

**Why two rendering paths.** The site side has to pay the "no framework" price to get SEO, cacheable static output and a readable theme contract. The admin side has none of those constraints but concentrates the highest UI complexity. Each side gets the better tool, and the two **must stay physically isolated** — that isolation is the source of many rules below.

## 3. Architecture red lines (vetoed in review)

### 3.1 Boundaries

1. Introducing a frontend framework (React / Vue / Svelte / Solid / Astro / Next / Nuxt / Remix), a SPA, or a state library into the **site side** (`apps/site`, `packages/themes/**`, any template), or using Hono JSX there.
2. Frontend framework code appearing in the site build output, or the admin SPA being referenced by a site route.
3. The site Worker importing `@typeky/editor` (the editor belongs to the admin only).
4. Any `packages/*` other than `@typeky/platform` importing Cloudflare binding types (`D1Database`, `R2Bucket`, `KVNamespace`) directly.
5. Building SQL in routes or handlers — all data access must go through the repositories in `@typeky/db`.

### 3.2 Content and templates

6. Introducing a custom content model (collections, dynamic fields, a dynamic form engine) — the content types are fixed at three.
7. Letting the admin create **new** template files or upload a whole theme package — only editing the theme's existing templates is allowed.
8. Using `| raw` on user-controlled content, or hand-writing `<script>` / JSON-LD inside a template.
9. Putting host functions, class instances or anything with `toValue()` into the render context (templates may only consume plain JSON data).
10. Adding a custom Liquid tag or filter and exposing it to editable templates without limits.

### 3.3 Dependencies and runtime

11. Introducing a **GPL / AGPL** dependency — its copyleft would conflict with the project's dual-licensing model (see §9). Specific permanent exclusions are in §4.
12. Introducing Redis / Docker / Kubernetes / Nginx / Caddy.
13. Running a database transaction longer than 1 second inside a single request, or loading more than 50 MB into memory at once.
14. Calling third-party APIs synchronously on the request path (use a queue or go async).
15. Using KV for strong-consistency decisions beyond sessions (sessions may live in KV; all other read caches must be rebuildable).
16. Storing template sources in R2 and reading them repeatedly at render time — templates go through the two-level D1 lookup plus memoization.

## 4. Code conventions

**General**

- TypeScript `strict`; ESM only; `verbatimModuleSyntax` is on, so type imports must use `import type`.
- No `any` (use `unknown` and narrow); no `@ts-ignore` (use `@ts-expect-error` with a written reason).
- Prefer named exports; the only exception is a Worker's `export default`.
- File names kebab-case; variables and functions camelCase; types PascalCase.
- Reference internal packages through the workspace protocol: `"@typeky/core": "workspace:*"`.
- Each package's public entry point is its `src/index.ts`; cross-package imports go through the entry point only.

**Data**

- Time is always a **UTC ISO 8601 string** (`YYYY-MM-DDTHH:mm:ss.sssZ`).
- Primary keys are always **UUIDv7**, generated in the application layer (`@typeky/core/id`), never by a database function.
- JSON columns are stored as TEXT in D1; all reads and writes go through `@typeky/core/codec`.
- Product prices are currently **text labels**; no monetary arithmetic is performed.

**Dependencies**

- Before adding one, ask: can the standard library or an existing dependency do this? Do not pull in a framework to write what three packages' worth of code covers.
- License allowlist: **MIT / BSD-2 / BSD-3 / Apache-2.0 / ISC**. Anything else needs an issue first.
- Permanently excluded: TinyMCE (GPLv2+ since v7, and v8 self-hosting requires a license key), CKEditor 5 (GPLv2 or commercial), and any AGPL dependency.

**Comments and copy**

- All committed content is **English** — code comments, JSDoc, configuration comments and tool messages. The private maintainer notes under `internal/` are the only Chinese content, and they are not committed.
- Write comments that explain **why**, not what the code already says.
- User-facing strings (admin UI, error messages, email templates) are English; a Chinese admin locale is a later feature.

**Security**

- Never hardcode environment variables or secrets. Locally use `.dev.vars` (gitignored); in production use `wrangler secret`.
- Before committing, check: did I bring in a secret, `.dev.vars`, or a build artifact?

## 5. Commit conventions

> The commit log is this public repository's **development journal**. Anyone can use it to judge whether the project is moving, whether changes are credible, and which version introduced a behaviour change. Both format and granularity are therefore hard requirements.

### 5.1 Frequency: one commit per "slice"

- **One commit = one slice**: the smallest increment you can **verify yourself** (roughly 2 hours of work).
- Expected cadence: **5–7 commits per week**.
- Every commit must be self-consistent: `pnpm check` passes, nothing left half-finished.
- **No batching.** Do not pile three days of work into one "big commit" — that destroys readability, revertability and progress visibility all at once.
- Tag milestones with an annotated tag: `git tag -a v0.1.0 -m "..."`.

### 5.2 Format: Conventional Commits

```
<type>(<scope>): <subject>

<body>

<footer>
```

| Field | Rule |
| :---- | :---- |
| `type` | `feat` `fix` `refactor` `perf` `test` `docs` `chore` `build` `ci` `revert` |
| `scope` | `site` `admin` `core` `db` `platform` `theme-kit` `themes` `api` `editor` `scripts` `repo` |
| `subject` | **English** · imperative · lowercase first letter · no trailing period · ≤ 72 characters |
| `body` | Optional. Explain **why**, not what changed |
| `footer` | Optional: `BREAKING CHANGE:` / `Refs: #12` / `Closes: #12` |

Mark breaking changes with `!` after the type, for example `feat(core)!: change block json top-level shape`.

### 5.3 Good and bad

```
✅ feat(db): add d1 schema for pages posts and products
✅ fix(theme-kit): stop caching parsed templates across revisions
✅ refactor(core): extract block serializer behind a single entry point

❌ updated the code                ← no type, no information
❌ feat: added the database        ← must be imperative, not past tense
❌ feat(db): Added the schema.     ← past tense + trailing period
❌ feat(db): add d1 schema for pages posts and products and media
                                   ← over 72 characters and mixes several changes
```

### 5.4 Enforcement

- `.githooks/commit-msg` validates the format above and rejects non-conforming commits.
- `.githooks/pre-push` runs typechecking and the asset boundary assertions.
- Hooks are enabled through `core.hooksPath`; the root `package.json` `prepare` script configures it after install, so **a fresh clone needs no manual setup**.
- In an emergency you may use `git commit --no-verify`, but do not push non-conforming commits to a remote.

### 5.5 Branches and tags

- **Trunk-based by default**: commit straight to `main`, since every commit is required to pass checks on its own.
- Open a short-lived branch only for ① risky refactors, or ② features that need several days.
- Tags follow semantic versioning: `v0.1.0` will be the first usable MVP release, then one per milestone.

## 6. Layout and responsibilities

```
apps/
  site/           Site Worker — Hono + LiquidJS + D1/R2/KV; no frontend framework allowed
  admin/          Admin SPA — React + Vite + Tailwind + shadcn/ui
packages/
  core/           Domain model, Block JSON spec, UUIDv7, codec, zero-dependency blockToHtml()
  db/             Drizzle schema (SQLite) and repositories — the only entry point for data access
  platform/       StoragePort definition and Cloudflare adapters (D1 / R2 / KV / Cache)
  theme-kit/      Liquid runtime, two-level template loader, custom filters
  themes/default/ Default theme baseline: layouts / templates / snippets / assets
  api/            Admin JSON API contract (Zod schemas and types)
  design-tokens/  Tailwind design tokens shared by the site and the admin
  editor/         Block editor (Tiptap wrapper + Block JSON mapping) — admin-only
scripts/          Code generation, template compilation, static checks, boundary assertions
public/           Build output root (theme / static / admin; all gitignored)
```

**Three boundaries that matter**

1. `blockToHtml()` lives in `packages/core` and **stays dependency-free** — it is the single place that produces HTML.
2. Any React / Tiptap dependency may only appear in `packages/editor` and `apps/admin`.
3. `apps/site` must not import `@typeky/editor`; `pnpm check:boundaries` asserts this.

## 7. Local development and verification

```bash
pnpm install             # install dependencies (also enables the commit hooks)
pnpm dev                 # start the site Worker (wrangler dev)
pnpm dev:admin           # start the admin SPA

pnpm typecheck           # typecheck every workspace package
pnpm test                # unit tests (vitest)
pnpm check:boundaries    # asset boundary assertions
pnpm check               # all three at once — the standard pre-commit action
```

**Minimum requirement before committing**: `pnpm check` passes.

## 8. Documentation

| Tier | Location | Content |
| :---- | :---- | :---- |
| User docs | [`docs/`](docs/) | Deployment guide, user manual, theme development guide, FAQ |
| Contributor docs | repository root | [README](README.md), this file, [CHANGELOG](CHANGELOG.md), [SECURITY](SECURITY.md), [LICENSE](LICENSE) |
| Maintainer notes | not in this repository | Kept by the maintainer, never distributed |

Rules:

- Public documentation must not contain internal business data, unreleased commitments, or the maintainer's todo list and priorities.
- Every command in a public document must have been **actually run**, so it is copy-pasteable as-is.
- Public documentation is **English**. The [README](README.md) also ships a [Chinese version](README.zh-CN.md); other translations use a `*.zh-CN.md` style suffix when needed.

## 9. Contributor License Agreement (CLA)

External pull requests require signing a Contributor License Agreement that assigns the contribution's copyright to the project. That is what allows the project to offer both an AGPLv3 build and a commercial white-label license; without it, the dual-licensing model cannot stand up legally.

The signing flow (automated CLA checks) will land before the public launch. Until then the maintainer will confirm with you in the pull request.

## 10. Reporting issues

- **Bugs and feature requests**: open an issue with reproduction steps or the use case.
- **Security vulnerabilities**: do **not** open a public issue. Report privately via the channel described in [SECURITY.md](SECURITY.md).
