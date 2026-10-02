import { model } from '@typeky/core'
import { createMemoryDb, type MemoryDb } from '@typeky/platform/testing'
import { describe, expect, it } from 'vitest'
import { renderMigrationSql } from '../generate'

/**
 * The generated DDL is only a string until something runs it. These tests apply
 * it to a real SQLite engine and then ask the engine what it built, so a
 * mistyped constraint fails here instead of at deploy time.
 */
function migrate(): MemoryDb {
  const db = createMemoryDb()
  db.exec(renderMigrationSql(model))
  return db
}

interface ColumnInfo {
  name: string
  type: string
  notnull: number
  pk: number
}

const SQLITE_TYPE: Record<string, string> = {
  uuid: 'TEXT',
  text: 'TEXT',
  integer: 'INTEGER',
  boolean: 'INTEGER',
  json: 'TEXT',
  timestamp: 'TEXT',
}

describe('generated migration', () => {
  it('runs as a single script', () => {
    expect(() => migrate()).not.toThrow()
  })

  it('creates exactly the tables the model declares', async () => {
    const db = migrate()

    const rows = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )

    expect(rows.map((row) => row.name)).toEqual([...model.tables.map((table) => table.name)].sort())
  })

  it('gives every column the storage class its logical type maps to', async () => {
    const db = migrate()

    for (const table of model.tables) {
      const columns = await db.all<ColumnInfo>(`PRAGMA table_info(${table.name})`)
      const actual = new Map(columns.map((column) => [column.name, column]))

      expect([...actual.keys()]).toEqual(table.columns.map((column) => column.name))

      for (const column of table.columns) {
        const info = actual.get(column.name)
        expect(info?.type, `${table.name}.${column.name} type`).toBe(SQLITE_TYPE[column.type])
        expect(info?.notnull === 1, `${table.name}.${column.name} not null`).toBe(
          column.primaryKey === true || column.notNull === true,
        )
        expect(info?.pk === 1, `${table.name}.${column.name} primary key`).toBe(column.primaryKey === true)
      }
    }
  })

  it('creates every named index the model declares', async () => {
    const db = migrate()

    const rows = await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name",
    )

    const declared = model.tables.flatMap((table) => table.indexes ?? []).map((index) => index.name)
    expect(rows.map((row) => row.name)).toEqual([...declared].sort())
  })

  it('makes the partial index partial, not a plain unique index', async () => {
    const db = migrate()

    const row = await db.first<{ sql: string }>(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'uq_pages_home'",
    )

    expect(row?.sql).toContain('WHERE is_home = 1')
  })

  it('refuses a second home page', async () => {
    const db = migrate()

    await db.run(
      "INSERT INTO pages (id, title, slug, is_home, created_at, updated_at) VALUES ('p1', 'Home', 'home', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )

    await expect(
      db.run(
        "INSERT INTO pages (id, title, slug, is_home, created_at, updated_at) VALUES ('p2', 'Other', 'other', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      ),
    ).rejects.toThrow(/UNIQUE/i)
  })

  it('allows many non-home pages, since the index only covers is_home = 1', async () => {
    const db = migrate()

    await db.run(
      "INSERT INTO pages (id, title, slug, is_home, created_at, updated_at) VALUES ('p1', 'About', 'about', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )
    await db.run(
      "INSERT INTO pages (id, title, slug, is_home, created_at, updated_at) VALUES ('p2', 'Contact', 'contact', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )

    await expect(db.all('SELECT id FROM pages')).resolves.toHaveLength(2)
  })

  it('enforces foreign keys, matching the D1 default', async () => {
    const db = migrate()

    await expect(
      db.run(
        "INSERT INTO posts (id, title, slug, cover_media_id, created_at, updated_at) VALUES ('x', 't', 's', 'missing', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      ),
    ).rejects.toThrow(/FOREIGN KEY/i)
  })

  it('clears the reference instead of blocking a media delete', async () => {
    const db = migrate()

    await db.run(
      "INSERT INTO media (id, filename, storage_key, mime_type, byte_size, created_at) VALUES ('m1', 'a.png', 'seed/a.png', 'image/png', 10, '2026-01-01T00:00:00.000Z')",
    )
    await db.run(
      "INSERT INTO posts (id, title, slug, cover_media_id, created_at, updated_at) VALUES ('x', 't', 's', 'm1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )

    await db.run("DELETE FROM media WHERE id = 'm1'")

    const post = await db.first<{ cover_media_id: string | null }>('SELECT cover_media_id FROM posts')
    expect(post?.cover_media_id).toBeNull()
  })

  it('scopes template overrides by theme and path', async () => {
    const db = migrate()
    const insert = (id: string, theme: string, path: string) =>
      db.run(
        `INSERT INTO theme_templates (id, theme, path, source, updated_at) VALUES ('${id}', '${theme}', '${path}', 'x', '2026-01-01T00:00:00.000Z')`,
      )

    await insert('t1', 'default', 'templates/post')

    await expect(insert('t2', 'default', 'templates/post')).rejects.toThrow(/UNIQUE/i)
    await expect(insert('t3', 'other', 'templates/post')).resolves.toBe(1)
  })

  it('applies the column defaults the model declares', async () => {
    const db = migrate()

    await db.run(
      "INSERT INTO pages (id, title, slug, created_at, updated_at) VALUES ('p1', 'About', 'about', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
    )

    const page = await db.first<{
      status: string
      is_home: number
      sort_order: number
      revision: number
      content_blocks: string
      seo_metadata: string
    }>('SELECT status, is_home, sort_order, revision, content_blocks, seo_metadata FROM pages')

    expect(page).toEqual({
      status: 'draft',
      is_home: 0,
      sort_order: 0,
      revision: 1,
      content_blocks: '[]',
      seo_metadata: '{}',
    })
  })
})
