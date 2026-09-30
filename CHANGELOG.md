# Changelog

Notable changes that affect users. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

When to update: **at each milestone** (see the [README](README.md#roadmap) roadmap), together with the release tag. Day-to-day commits do not need to touch this file — the commit log is the fine-grained record (see [CONTRIBUTING](CONTRIBUTING.md#5-commit-conventions)).

## [Unreleased]

### Added

- Monorepo skeleton on pnpm workspaces, with `apps/site` (site Worker), `apps/admin` (admin SPA) and shared `packages/*`
- `pnpm check:boundaries` asset boundary assertions: no frontend framework on the site side, no editor package imported by the site Worker
- Commit message convention with Git hooks (`.githooks/commit-msg` validates the format, `.githooks/pre-push` gates pushes)
- Public documentation: [README](README.md) ([Chinese](README.zh-CN.md)), [CONTRIBUTING](CONTRIBUTING.md), [SECURITY](SECURITY.md), this file, [LICENSE](LICENSE)

### Notes

- **Not yet usable for building a site.** The repository currently holds the engineering skeleton and documentation only.
- The site Worker exposes a single health-check endpoint at this stage, used to verify the local development and build pipeline.
