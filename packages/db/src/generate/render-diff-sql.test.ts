import type { ColumnDef, LogicalModel, TableDef } from '@typeky/core'
import { createMemoryDb, type MemoryDb } from '@typeky/platform/testing'
import { describe, expect, it } from 'vitest'
import { diffModels } from './diff'
import { renderDiffSql } from './render-diff-sql'
import { renderMigrationSql } from './render-sql'

/**
 * The SQL a diff renders to, applied to a real database.
 *
 * `diff.test.ts` checks what changed and this checks the statements that carry it,
 * which is a different question: the first version of this renderer emitted
 * `ALTER TABLE pages ADD COLUMN INTEGER NOT NULL DEFAULT 1` -- the column's name
 * missing entirely -- and every diff test passed, because they never looked at the
 * text. Nothing short of running it catches that, so that is what these do: build
 * the old model, apply the migration, and compare the result with the new model.
 */

function column(overrides: Partial<ColumnDef> & { name: string }): ColumnDef {
  return { type: 'text', ...overrides }
}

function table(name: string, overrides: Partial<TableDef> = {}): TableDef {
  return { name, columns: [{ name: 'id', type: 'uuid', primaryKey: true }], ...overrides }
}

function model(...tables: TableDef[]): LogicalModel {
  return { formatVersion: 1, tables }
}

interface Shape {
  [table: string]: { columns: string[]; foreignKeys: string[]; indexes: string[] }
}

/**
 * What a database contains, read back rather than remembered.
 *
 * Columns as a set, because `ALTER TABLE ADD COLUMN` appends where the model may
 * have the column in the middle -- a real difference in `select *` order and not
 * one that changes what the data means.
 */
async function describeSchema(db: MemoryDb): Promise<Shape> {
  const tables = await db.all<{ name: string }>(
    `select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name`,
  )

  const shape: Shape = {}

  for (const entry of tables) {
    const columns = await db.all<{
      name: string
      type: string
      notnull: number
      dflt_value: string | null
    }>(`pragma table_info(${entry.name})`)

    const foreignKeys = await db.all<{ from: string; table: string; to: string; on_delete: string }>(
      `pragma foreign_key_list(${entry.name})`,
    )

    const indexes = await db.all<{ name: string }>(`pragma index_list(${entry.name})`)

    shape[entry.name] = {
      columns: columns
        .map((row) => `${row.name}:${row.type}:${row.notnull}:${row.dflt_value ?? ''}`)
        .sort(),
      foreignKeys: foreignKeys
        .map((key) => `${key.from}->${key.table}.${key.to}:${key.on_delete}`)
        .sort(),
      indexes: indexes.map((row) => row.name).sort(),
    }
  }

  return shape
}

/** Applies the diff to the old model and renders the new one, for comparison. */
async function migrated(before: LogicalModel, after: LogicalModel): Promise<Shape> {
  const applied = createMemoryDb()
  applied.exec(renderMigrationSql(before))
  applied.exec(renderDiffSql(diffModels(before, after), after))

  const fromModel = createMemoryDb()
  fromModel.exec(renderMigrationSql(after))

  expect(await describeSchema(applied)).toEqual(await describeSchema(fromModel))
  return describeSchema(applied)
}

describe('applying a rendered diff', () => {
  it('adds a column, with its name', async () => {
    const before = model(table('pages'))
    const after = model(
      table('pages', {
        columns: [
          column({ name: 'id', type: 'uuid', primaryKey: true }),
          column({ name: 'use_layout', type: 'boolean', notNull: true, defaultSql: '1' }),
        ],
      }),
    )

    const shape = await migrated(before, after)

    expect(shape.pages?.columns).toContain('use_layout:INTEGER:1:1')
  })

  it('drops a column and the index over it', async () => {
    const before = model(
      table('posts', {
        columns: [column({ name: 'id', type: 'uuid', primaryKey: true }), column({ name: 'category' })],
        indexes: [{ name: 'idx_posts_category', columns: ['category'] }],
      }),
    )

    const shape = await migrated(before, model(table('posts')))

    expect(shape.posts?.columns).toEqual(['id:TEXT:1:'])
  })

  it('creates a table with its indexes and foreign keys', async () => {
    const before = model()
    const after = model(
      table('vocabularies'),
      table('terms', {
        columns: [
          column({ name: 'id', type: 'uuid', primaryKey: true }),
          {
            name: 'vocabulary_id',
            type: 'uuid',
            notNull: true,
            references: { table: 'vocabularies', column: 'id', onDelete: 'cascade' },
          },
        ],
        indexes: [{ name: 'idx_terms_vocabulary', columns: ['vocabulary_id'] }],
      }),
    )

    const shape = await migrated(before, after)

    expect(shape.terms?.foreignKeys).toEqual(['vocabulary_id->vocabularies.id:CASCADE'])
    expect(shape.terms?.indexes).toContain('idx_terms_vocabulary')
  })

  it('drops a table, rows and indexes with it', async () => {
    const shape = await migrated(
      model(
        table('terms', {
          columns: [column({ name: 'id', type: 'uuid', primaryKey: true }), column({ name: 'name' })],
          indexes: [{ name: 'idx_terms', columns: ['name'] }],
        }),
      ),
      model(),
    )

    expect(Object.keys(shape)).toEqual([])
  })

  it('replaces an index whose columns changed', async () => {
    const postColumns = [
      column({ name: 'id', type: 'uuid', primaryKey: true }),
      column({ name: 'title' }),
      column({ name: 'slug' }),
    ]
    const before = model(
      table('posts', { columns: postColumns, indexes: [{ name: 'idx_posts', columns: ['title'] }] }),
    )
    const after = model(
      table('posts', { columns: postColumns, indexes: [{ name: 'idx_posts', columns: ['title', 'slug'] }] }),
    )

    const applied = createMemoryDb()
    applied.exec(renderMigrationSql(before))
    applied.exec(renderDiffSql(diffModels(before, after), after))

    const columns = await applied.all<{ name: string }>(`pragma index_info(idx_posts)`)

    expect(columns.map((row) => row.name)).toEqual(['title', 'slug'])
  })
})
