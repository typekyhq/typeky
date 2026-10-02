import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { model } from '@typeky/core'
import { renderDrizzleSchema, renderMigrationSql } from '../src/generate'
import { repoRoot } from './paths'

interface Target {
  label: string
  path: string
  content: string
}

/**
 * Everything derived from packages/core/src/model/schema.ts.
 *
 * Adding a table or column means adding it to the model and running
 * `pnpm db:generate`. Nothing here should ever be edited by hand.
 */
const targets: Target[] = [
  {
    label: 'Drizzle schema',
    path: resolve(repoRoot, 'packages/db/src/d1/schema.ts'),
    content: renderDrizzleSchema(model),
  },
  {
    label: 'D1 migration',
    path: resolve(repoRoot, 'apps/site/migrations/0001_init.sql'),
    content: renderMigrationSql(model),
  },
]

const mode = process.argv[2]

if (mode === 'generate') {
  const rewritten: Target[] = []

  for (const target of targets) {
    const current = existsSync(target.path) ? readFileSync(target.path, 'utf8') : undefined
    mkdirSync(dirname(target.path), { recursive: true })
    writeFileSync(target.path, target.content, 'utf8')
    if (current !== target.content) rewritten.push(target)
    console.log(
      `  ${target.label}: wrote ${relative(repoRoot, target.path)}${current === target.content ? ' (unchanged)' : ''}`,
    )
  }

  // Saying this out loud is the whole point. The migration is rewritten in place
  // rather than appended to, so an existing local database never learns about the
  // change -- wrangler has recorded this file as applied and skips it. The
  // symptom is a screen that answers 500, with nothing on it to say why.
  if (rewritten.some((target) => target.label === 'D1 migration')) {
    console.log('  the migration was rewritten, so an existing local database does not have the change.')
    console.log('  run `pnpm db:reset` to rebuild the local one (it deletes local data).')
  }

  console.log('  ok')
} else if (mode === 'check') {
  const stale = targets.filter((target) => {
    const current = existsSync(target.path) ? readFileSync(target.path, 'utf8') : undefined
    return current !== target.content
  })

  if (stale.length > 0) {
    console.error('  schema drift detected, generated output no longer matches the model:')
    for (const target of stale) console.error(`    ${target.label}: ${relative(repoRoot, target.path)}`)
    console.error('  run `pnpm db:generate` and commit the result')
    process.exit(1)
  }

  console.log('  ok (model, Drizzle schema and migration agree)')
} else {
  console.error('usage: tsx scripts/schema.ts <generate|check>')
  process.exit(1)
}
