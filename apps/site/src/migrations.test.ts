import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { model } from '@typeky/core'
import { renderMigrationSql } from '@typeky/db'
import { createMemoryDb, type MemoryDb } from '@typeky/platform/testing'
import { describe, expect, it } from 'vitest'

/**
 * The migration history against the model.
 *
 * The repository tests build their database from the model, which is right -- they
 * are testing the repositories, not the migrations -- but it means nothing else
 * would notice if the migration files stopped describing the same schema. A
 * deployed database is built from these files, so the two must agree, and the only
 * way to know is to apply every migration in order and compare the result with
 * what the model renders.
 *
 * Applied one statement at a time, like SQLite does. `exec` takes a whole script,
 * which is how the files are written; the comparison is what matters.
 */

// `import.meta.url` as a string rather than `new URL(...)`: the admin app's
// tsconfig gives this package the DOM `URL`, which is not the one node accepts.
const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '../migrations')

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

interface TableShape {
  columns: string[]
  foreignKeys: string[]
  indexes: string[]
}

type Shape = Record<string, TableShape>

/**
 * What a database *is*, as SQLite describes it rather than as it was written.
 *
 * `pragma`, not the text of `sqlite_master`: a column added by `ALTER TABLE` and
 * one written into a `CREATE TABLE` are the same column, and comparing the source
 * text would fail for reasons that do not matter.
 *
 * Columns are compared as a set. A migrated column is appended where the model may
 * have it in the middle, and `select *` order is the one difference that changes
 * nothing about the data.
 */
async function inspect(db: MemoryDb): Promise<Shape> {
  const tables = await db.all<{ name: string }>(
    `select name from sqlite_master
      where type = 'table'
        and name not like 'sqlite_%'
        and name not like '_cf_%'
        and name <> 'd1_migrations'
      order by name`,
  )

  const shape: Shape = {}

  for (const table of tables) {
    const columns = await db.all<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
      pk: number
    }>(`pragma table_info(${table.name})`)

    const foreignKeys = await db.all<{
      from: string
      table: string
      to: string
      on_delete: string
    }>(`pragma foreign_key_list(${table.name})`)

    const indexes = await db.all<{ name: string; unique: number }>(`pragma index_list(${table.name})`)
    const described: string[] = []
    for (const index of indexes) {
      const info = await db.all<{ name: string }>(`pragma index_info(${index.name})`)
      described.push(`${index.name}:${index.unique}:${info.map((column) => column.name).join(',')}`)
    }

    shape[table.name] = {
      columns: columns
        .map((column) => `${column.name}:${column.type}:${column.notnull}:${column.dflt_value ?? ''}:${column.pk}`)
        .sort(),
      foreignKeys: foreignKeys
        .map((key) => `${key.from}->${key.table}.${key.to}:${key.on_delete}`)
        .sort(),
      indexes: described.sort(),
    }
  }

  return shape
}

describe('the migration history', () => {
  const files = migrationFiles()

  it('starts at 0001 and has no gaps', () => {
    // A hand-written migration with the wrong number is a migration that applies
    // in the wrong order, and wrangler records the name, so the order it ran in
    // cannot be corrected afterwards.
    expect(files.map((name) => name.slice(0, 4))).toEqual(
      files.map((_, index) => String(index + 1).padStart(4, '0')),
    )
  })

  it('rebuilds exactly the schema the model describes', async () => {
    const replayed = createMemoryDb()
    for (const name of files) {
      replayed.exec(readFileSync(join(MIGRATIONS, name), 'utf8'))
    }

    const fromModel = createMemoryDb()
    fromModel.exec(renderMigrationSql(model))

    expect(await inspect(replayed)).toEqual(await inspect(fromModel))
  })
})
