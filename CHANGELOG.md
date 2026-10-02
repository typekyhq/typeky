# Changelog

Notable changes that affect users. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

When to update: **at each milestone** (see the [README](README.md#roadmap) roadmap), together with the release tag. Day-to-day commits do not need to touch this file — the commit log is the fine-grained record (see [CONTRIBUTING](CONTRIBUTING.md#5-commit-conventions)).

## [Unreleased]

### Added

- Monorepo skeleton on pnpm workspaces, with `apps/site` (site Worker), `apps/admin` (admin SPA) and shared `packages/*`
- `pnpm check:boundaries` asset boundary assertions: no frontend framework on the site side, no editor package imported by the site Worker
- Commit message convention with Git hooks (`.githooks/commit-msg` validates the format, `.githooks/pre-push` gates pushes)
- Public documentation: [README](README.md) ([Chinese](README.zh-CN.md)), [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), this file, [LICENSE](LICENSE)
- **Content.** Pages, posts and products, each with a list (status filter, search, sorting, paging), an editor, publishing, bulk publish/delete, and slug uniqueness with a conflict that names the post already holding it
- **Block editor.** Nine block types on Tiptap, stored as structured Block JSON — never HTML. Toolbar, block movement, drag handle and a `/` menu; paste is sanitised structurally, and a table from a web page becomes one paragraph per row rather than a run of glued-together cells
- **Media library.** Uploads through the Worker into R2, a grid with search, a delete that says what it will affect, and a picker reachable from posts, products and settings
- **Online theme editing.** Browse the templates the theme ships, edit one with syntax highlighting, preview it unsaved in a sandboxed frame, save it — live on the next page rendered, in every isolate — and restore the bundled version in one click
- **SEO overrides** per document: meta title, description, social image and canonical, with the site-wide defaults as the fallback
- **A sandbox.** A theme is untrusted input: tags and filters are whitelisted, output is escaped, render time, memory, output size and template size are capped, template names are a closed set, and `pnpm test:sandbox` is the list of things a theme must not be able to do
- Documentation for using it: [docs/](docs/README.md), including a [theme development guide](docs/theme-development.md)

### Notes

- **The front end does not render pages yet.** The admin panel is complete for content, media and themes; the site itself still serves a placeholder. That is milestone 6.
- The site Worker exposes a health-check endpoint and the admin API; the public read-only API arrives with the front end.
- Slug change history (301 redirects) and direct-to-R2 uploads are deliberately deferred; both are recorded in the backlog with the reason.
