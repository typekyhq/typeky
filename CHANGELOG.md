# Changelog

Notable changes that affect users. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

When to update: **at each milestone** (see the [README](README.md#roadmap) roadmap), together with the release tag. Day-to-day commits do not need to touch this file — the commit log is the fine-grained record (see [CONTRIBUTING](CONTRIBUTING.md#5-commit-conventions)).

## [Unreleased]

## [0.1.0] - 2026-10-04

The CE MVP: a site you can build and host on your own Cloudflare account, edited entirely from the admin panel.

### Added

- **The front end.** The site Worker renders published pages, posts and products from the database — list pages with pagination, detail pages with their blocks, posts with a cover, excerpt, tags and terms, products with a gallery, specs, a price label and an external call to action, and a 404. Per-document SEO (title, description, canonical, Open Graph) with site-wide defaults, `sitemap.xml`, `robots.txt` (including the operator's own rules), structured data, and a light default theme.
- **Content.** Pages, posts and products, each with a list (status filter, search, sorting, paging), an editor, publishing, bulk publish/delete, and slug uniqueness with a conflict that names the content already holding it. A page can be marked as home, or made its own document with a custom template.
- **Block editor.** Nine block types on Tiptap, stored as structured Block JSON — never HTML. Toolbar, block movement, drag handle and a `/` menu; paste is sanitised structurally, and a table from a web page becomes one paragraph per row rather than a run of glued-together cells.
- **Media library.** Uploads through the Worker into R2 with a filename and alt text, a grid with search, an alt text you can edit after the fact, a delete that says what it will affect, and a picker reachable from posts, products and settings.
- **Taxonomy.** Vocabularies of nested terms, attached to posts and products, shown as chips on the site, with a `/category/{slug}` archive page for each term.
- **Online theme editing.** Browse the templates the theme ships, edit one with syntax highlighting, preview it unsaved in a sandboxed frame, save it — live on the next page rendered, in every isolate — and restore the bundled version in one click. Upload a theme as a folder; a file it does not ship falls back to the bundled theme. Delete an uploaded theme, which moves the site back to the bundled one.
- **Theme authoring help.** Two generated documents — the template syntax and a prompt to hand a model — read in the panel or downloaded, both derived from the real Liquid surface rather than written by hand.
- **Settings.** Site name, tagline, logo, favicon, navigation, social links, footer text, site language, date format and timezone, SEO defaults (title template, default share image, site-wide noindex, extra `Disallow` paths), and custom key/value settings a theme can read.
- **A movable admin path**, a failed-login lockout, and the site's logo on the sign-in form.
- **The panel in nine languages.** English, 简体中文, العربية, Français, Русский, Português (Brasil), Español, 日本語 and 한국어, with right-to-left layout for Arabic.
- **White-label licensing.** An offline ED25519 licence key bound to a domain removes the "Powered by Typeky" attribution from the site and the panel. A key that does not apply is reported in the panel and never blocks the site.
- **Dashboard.** An overview of what the site holds: counts, drafts and the most recent publication.
- **One-click deploy.** [Deploying Typeky](docs/quick-start.md) walks through creating the resources, deploying, the first five minutes and binding your own domain, with a least-privilege token list.
- A monorepo skeleton on pnpm workspaces, `pnpm check:boundaries` asset assertions, commit-message hooks, and documentation for using it: [docs/](docs/README.md) and a [theme development guide](docs/theme-development.md).

### Notes

- **The cold-start walkthrough has not been run on a real, blank Cloudflare account.** Every deploy command is documented, and each was run as far as it goes without creating resources; the end-to-end pass on a blank account is the remaining check.
- The admin JSON API stays at `/api/admin` even when the panel moves. Its defence is the login lockout, not obscurity — recorded in the backlog.
- A licence change does not take effect for an already-cached page until it expires or the site is published again. The cache key is the URL, and putting the licence in it was not worth the cost.
- Term slugs are unique per vocabulary, but a term's archive URL is one segment (`/category/{slug}`): a slug held by two vocabularies resolves to one of them, and the sitemap lists the path once.
- Slug change history (301 redirects), direct-to-R2 uploads, and a designed dark palette are deliberately deferred, each with the reason in the backlog.

[Unreleased]: https://github.com/typekyhq/typeky/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/typekyhq/typeky/releases/tag/v0.1.0
