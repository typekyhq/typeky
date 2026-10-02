import type { ColumnDef, LogicalModel, TableDef } from '@typeky/core'
import { describe, expect, it } from 'vitest'
import { diffModels, migrationSlug } from './diff'

/**
 * The difference between two models.
 *
 * The cases worth pinning are the ones where a wrong answer loses data or fails
 * halfway through a deploy: a NOT NULL column SQLite will refuse to add, a change
 * that needs a table rebuild being reported instead of attempted, and the order of
 * the statements themselves.
 */

function column(overrides: Partial<ColumnDef> & { name: string }): ColumnDef {
  return { type: 'text', ...overrides }
}

function table(name: string, overrides: Partial<TableDef> = {}): TableDef {
  return {
    name,
    columns: [{ name: 'id', type: 'uuid', primaryKey: true }],
    ...overrides,
  }
}

function model(...tables: TableDef[]): LogicalModel {
  return { formatVersion: 1, tables }
}

describe('diffing two models', () => {
  it('reports nothing when nothing changed', () => {
    const one = model(table('posts'))

    expect(diffModels(one, one)).toEqual({ changes: [], unsupported: [] })
  })

  it('ignores a reworded comment, which is not a migration', () => {
    const before = model(table('posts', { note: 'Old words' }))
    const after = model(table('posts', { note: 'New words' }))

    expect(diffModels(before, after).changes).toEqual([])
  })

  it('creates a table that was added, with its indexes', () => {
    const before = model()
    const after = model(
      table('terms', {
        columns: [column({ name: 'id', type: 'uuid', primaryKey: true }), column({ name: 'slug' })],
        indexes: [{ name: 'idx_terms_slug', columns: ['slug'] }],
      }),
    )

    expect(diffModels(before, after).changes).toEqual([
      {
        kind: 'create_table',
        table: table('terms', {
          columns: [column({ name: 'id', type: 'uuid', primaryKey: true }), column({ name: 'slug' })],
          indexes: [{ name: 'idx_terms_slug', columns: ['slug'] }],
        }),
      },
    ])
  })

  it('drops a table, and does not also drop its indexes one at a time', () => {
    const before = model(
      table('terms', { indexes: [{ name: 'idx_terms_slug', columns: ['slug'] }] }),
    )

    expect(diffModels(before, model()).changes).toEqual([{ kind: 'drop_table', table: 'terms' }])
  })

  it('adds a column that has a default', () => {
    const before = model(table('posts', { columns: [column({ name: 'id', type: 'uuid', primaryKey: true })] }))
    const after = model(
      table('posts', {
        columns: [
          column({ name: 'id', type: 'uuid', primaryKey: true }),
          column({ name: 'status', notNull: true, defaultSql: "'draft'" }),
        ],
      }),
    )

    expect(diffModels(before, after).changes).toEqual([
      { kind: 'add_column', table: 'posts', column: column({ name: 'status', notNull: true, defaultSql: "'draft'" }) },
    ])
  })

  it('refuses a NOT NULL column with no default, which SQLite will not add', () => {
    const before = model(table('posts'))
    const after = model(
      table('posts', {
        columns: [
          column({ name: 'id', type: 'uuid', primaryKey: true }),
          column({ name: 'title', notNull: true }),
        ],
      }),
    )

    const diff = diffModels(before, after)

    expect(diff.changes).toEqual([])
    expect(diff.unsupported).toEqual([
      'posts.title: a NOT NULL column with no default cannot be added in place; give it a default, or write the rebuild by hand',
    ])
  })

  it('refuses a column that is added as a key', () => {
    const before = model(table('posts'))
    const after = model(
      table('posts', {
        columns: [
          column({ name: 'id', type: 'uuid', primaryKey: true }),
          column({ name: 'slug', unique: true }),
        ],
      }),
    )

    expect(diffModels(before, after).unsupported).toEqual([
      'posts.slug: SQLite cannot add a PRIMARY KEY or UNIQUE column in place',
    ])
  })

  it('drops a column, after dropping the index that covers it', () => {
    const before = model(
      table('posts', {
        columns: [column({ name: 'id', type: 'uuid', primaryKey: true }), column({ name: 'category' })],
        indexes: [{ name: 'idx_posts_category', columns: ['category'] }],
      }),
    )
    const after = model(table('posts'))

    // The index first: SQLite refuses to drop a column an index still uses.
    expect(diffModels(before, after).changes).toEqual([
      { kind: 'drop_index', index: 'idx_posts_category' },
      { kind: 'drop_column', table: 'posts', column: 'category' },
    ])
  })

  it('refuses a changed column, which needs a rebuild', () => {
    const before = model(table('posts', { columns: [column({ name: 'id', type: 'uuid', primaryKey: true }), column({ name: 'title' })] }))
    const after = model(table('posts', { columns: [column({ name: 'id', type: 'uuid', primaryKey: true }), column({ name: 'title', notNull: true })] }))

    expect(diffModels(before, after).unsupported).toEqual([
      'posts.title: changing a column needs a table rebuild',
    ])
  })

  it('refuses a table-level UNIQUE that changed', () => {
    const before = model(table('terms', { uniques: [{ columns: ['vocabulary_id', 'slug'] }] }))
    const after = model(table('terms', { uniques: [{ columns: ['slug'] }] }))

    expect(diffModels(before, after).unsupported).toEqual([
      'terms: adding or removing a table-level UNIQUE needs a table rebuild',
    ])
  })

  it('adds and drops an index on a table that stays', () => {
    const before = model(table('posts', { indexes: [{ name: 'idx_old', columns: ['title'] }] }))
    const after = model(table('posts', { indexes: [{ name: 'idx_new', columns: ['title'] }] }))

    expect(diffModels(before, after).changes).toEqual([
      { kind: 'drop_index', index: 'idx_old' },
      { kind: 'create_index', table: after.tables[0], index: { name: 'idx_new', columns: ['title'] } },
    ])
  })

  it('replaces an index whose columns changed', () => {
    const before = model(table('posts', { indexes: [{ name: 'idx_posts', columns: ['title'] }] }))
    const after = model(table('posts', { indexes: [{ name: 'idx_posts', columns: ['title', 'slug'] }] }))

    // An index holds no rows, so unlike a table-level UNIQUE it can be replaced.
    expect(diffModels(before, after).changes).toEqual([
      { kind: 'drop_index', index: 'idx_posts' },
      {
        kind: 'create_index',
        table: after.tables[0],
        index: { name: 'idx_posts', columns: ['title', 'slug'] },
      },
    ])
  })
})

describe('naming a migration after what it does', () => {
  it('names added tables', () => {
    const diff = diffModels(
      model(),
      model(table('vocabularies'), table('terms'), table('content_terms')),
    )

    expect(migrationSlug(diff)).toBe('vocabularies_terms_content_terms')
  })

  it('names a dropped column', () => {
    const before = model(
      table('posts', { columns: [column({ name: 'id', type: 'uuid', primaryKey: true }), column({ name: 'category' })] }),
    )
    const after = model(table('posts'))

    expect(migrationSlug(diffModels(before, after))).toBe('drop_posts_category')
  })

  it('does not let an index rename make the name longer than it has to be', () => {
    const before = model(table('posts', { indexes: [{ name: 'idx_a', columns: ['title'] }] }))
    const after = model(table('posts', { indexes: [{ name: 'idx_b', columns: ['title'] }] }))

    expect(migrationSlug(diffModels(before, after))).toBe('schema')
  })

  it('is the same for the same change, which is what makes a name safe to record', () => {
    const before = model()
    const after = model(table('terms'))

    expect(migrationSlug(diffModels(before, after))).toBe(migrationSlug(diffModels(before, after)))
  })
})
