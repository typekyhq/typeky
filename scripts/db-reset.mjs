#!/usr/bin/env node
/**
 * Rebuilds the local D1 database from the generated migration.
 *
 * The model is the source of truth, and `pnpm db:generate` rewrites
 * `apps/site/migrations/0001_init.sql` in place rather than appending a migration.
 * That is right while CE has never shipped -- one initialization script that
 * always describes the current schema -- but it has a consequence that is invisible
 * until something breaks: an existing local database is never told about a table
 * added since it was created, because wrangler has recorded `0001_init.sql` as
 * applied and skips it. The symptom is a screen that answers 500 with no reason
 * anywhere on it.
 *
 * So a local database is disposable, and this is how to dispose of it. The remote
 * one is not touched: `pnpm db:migrate:remote` has no equivalent until migrations
 * become append-only, which is what shipping a release changes.
 *
 * `--check` prints what it would remove and stops, because a script that deletes
 * data should be readable before it is run.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../', import.meta.url))

// Wrangler keeps local bindings beside the config it was given, which is
// apps/site/wrangler.jsonc -- not in the directory the command ran from.
const state = resolve(repoRoot, 'apps/site/.wrangler/state/v3/d1')
const check = process.argv.includes('--check')

if (!existsSync(state)) {
  console.log(`db:reset -- nothing to remove at ${state}`)
} else if (check) {
  console.log(`db:reset -- would remove ${state}`)
} else {
  rmSync(state, { recursive: true, force: true })
  console.log(`db:reset -- removed ${state}`)
}

if (check) process.exit(0)

const migrate = spawnSync('pnpm', ['db:migrate'], { cwd: repoRoot, stdio: 'inherit' })
process.exit(migrate.status ?? 1)
