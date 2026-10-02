import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { model, type LogicalModel } from '@typeky/core'
import { diffModels, migrationSlug, renderDiffSql, renderDrizzleSchema } from '../src/generate'
import { repoRoot } from './paths'

/**
 * Everything derived from packages/core/src/model/schema.ts.
 *
 * Adding a table or column means adding it to the model and running
 * `pnpm db:generate`. Nothing here should ever be edited by hand.
 *
 * Two of the three outputs are the model, rendered whole: the Drizzle schema is a
 * type-level mirror, and `renderMigrationSql` builds a database that matches the
 * model (which is what the repository tests do). The third is history. A migration
 * that has been applied is never rewritten -- a database records which ones it has
 * run by file name, so rewriting one means an existing database is never told
 * about the change. Changes since `0001_init.sql` are therefore appended, as the
 * difference between the model and the snapshot of the model the migrations
 * already describe.
 */

const SNAPSHOT = resolve(repoRoot, 'packages/db/model.snapshot.json')
const MIGRATIONS = resolve(repoRoot, 'apps/site/migrations')
const DRIZZLE = resolve(repoRoot, 'packages/db/src/d1/schema.ts')

function readIfExists(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function readSnapshot(): LogicalModel | null {
  const text = readIfExists(SNAPSHOT)
  return text === undefined ? null : (JSON.parse(text) as LogicalModel)
}

/** The next free number, so an appended migration never collides with one there. */
function nextMigrationPath(slug: string): string {
  const names = existsSync(MIGRATIONS) ? readdirSync(MIGRATIONS) : []
  const numbers = names
    .map((name) => /^(\d{4})_/.exec(name)?.[1])
    .filter((value): value is string => value !== undefined)
    .map(Number)

  const next = (numbers.length === 0 ? 1 : Math.max(...numbers) + 1).toString().padStart(4, '0')
  return join(MIGRATIONS, `${next}_${slug}.sql`)
}

const mode = process.argv[2]
const accept = process.argv.includes('--accept')

if (mode === 'generate') {
  // The Drizzle schema is the whole model every time: it is a mirror, not a
  // history, so it has nothing to do with what has been applied.
  const drizzle = renderDrizzleSchema(model)
  const drizzleUnchanged = readIfExists(DRIZZLE) === drizzle
  mkdirSync(dirname(DRIZZLE), { recursive: true })
  writeFileSync(DRIZZLE, drizzle, 'utf8')
  console.log(
    `  Drizzle schema: wrote ${relative(repoRoot, DRIZZLE)}${drizzleUnchanged ? ' (unchanged)' : ''}`,
  )

  const snapshot = readSnapshot()

  if (snapshot === null) {
    // Nothing to diff against: the migrations that exist were written before this
    // generator kept a snapshot, and the thing to record is where they leave the
    // schema. Create the snapshot by hand from the model as it was then.
    writeFileSync(SNAPSHOT, serialize(model), 'utf8')
    console.log(`  model snapshot: wrote ${relative(repoRoot, SNAPSHOT)} (no migration written)`)
    console.log('  ok')
  } else {
    const diff = diffModels(snapshot, model)

    if (accept) {
      writeFileSync(SNAPSHOT, serialize(model), 'utf8')
      console.log(`  model snapshot: wrote ${relative(repoRoot, SNAPSHOT)}`)
      console.log('  --accept: no migration was written; the hand-written one carries this change')
      console.log('  ok')
      process.exit(0)
    }

    if (diff.unsupported.length > 0) {
      console.error('  this change cannot be written as an appended migration:')
      for (const problem of diff.unsupported) console.error(`    ${problem}`)
      console.error('  write the migration by hand -- SQLite needs the twelve-step rebuild for')
      console.error('  any of the above -- then run `pnpm db:generate --accept`. Nothing was written.')
      process.exit(1)
    }

    if (diff.changes.length === 0) {
      console.log('  no model changes: no migration written')
      console.log('  ok')
    } else {
      const path = nextMigrationPath(migrationSlug(diff))
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, renderDiffSql(diff, model), 'utf8')
      writeFileSync(SNAPSHOT, serialize(model), 'utf8')

      console.log(`  migration: wrote ${relative(repoRoot, path)} (${diff.changes.length} statements)`)
      console.log(`  model snapshot: wrote ${relative(repoRoot, SNAPSHOT)}`)
      console.log('  apply it to the local database with `pnpm db:migrate`')
      console.log('  ok')
    }
  }
} else if (mode === 'check') {
  const problems: string[] = []

  const drizzle = renderDrizzleSchema(model)
  if (readIfExists(DRIZZLE) !== drizzle) {
    problems.push(`the Drizzle schema no longer matches the model: ${relative(repoRoot, DRIZZLE)}`)
  }

  const snapshot = readSnapshot()
  if (snapshot === null) {
    problems.push(`the model snapshot is missing: ${relative(repoRoot, SNAPSHOT)}`)
  } else {
    const diff = diffModels(snapshot, model)
    if (diff.changes.length > 0) problems.push('the model has changes that no migration describes')
    for (const problem of diff.unsupported) problems.push(problem)
  }

  if (problems.length > 0) {
    console.error('  schema drift detected:')
    for (const problem of problems) console.error(`    ${problem}`)
    console.error('  run `pnpm db:generate` and commit the result')
    process.exit(1)
  }

  console.log('  ok (model, migrations and Drizzle schema agree)')
} else {
  console.error('usage: tsx scripts/schema.ts <generate|check> [--accept]')
  process.exit(1)
}
