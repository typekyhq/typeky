import { describe, expect, it } from 'vitest'
import { model } from './schema'

/**
 * Invariants the generators rely on. A failure here means `pnpm db:generate`
 * would emit something broken, so these run before the drift check.
 */
describe('logical persistence model', () => {
  it('declares exactly the six CE MVP tables', () => {
    expect(model.tables.map((table) => table.name)).toEqual([
      'media',
      'sites',
      'pages',
      'posts',
      'products',
      'theme_templates',
    ])
  })

  it('never introduces a tenant column, which is deliberately out of MVP scope', () => {
    const columns = model.tables.flatMap((table) => table.columns.map((column) => column.name))
    expect(columns).not.toContain('tenant_id')
    expect(model.tables.map((table) => table.name)).not.toContain('tenants')
  })

  it('declares every table before the tables that reference it', () => {
    const declared = new Set<string>()

    for (const table of model.tables) {
      for (const column of table.columns) {
        if (!column.references) continue
        expect(
          declared.has(column.references.table),
          `${table.name}.${column.name} references ${column.references.table}, which is declared later`,
        ).toBe(true)
      }
      declared.add(table.name)
    }
  })

  it('gives every table one primary key and unique column names', () => {
    for (const table of model.tables) {
      const primaryKeys = table.columns.filter((column) => column.primaryKey)
      expect(primaryKeys.map((column) => column.name), `${table.name} primary key`).toEqual(['id'])

      const names = table.columns.map((column) => column.name)
      expect(new Set(names).size, `${table.name} duplicate columns`).toBe(names.length)
    }
  })

  it('encodes the single home page rule as a partial unique index', () => {
    const pages = model.tables.find((table) => table.name === 'pages')
    expect(pages?.indexes).toContainEqual({
      name: 'uq_pages_home',
      columns: ['is_home'],
      unique: true,
      where: 'is_home = 1',
    })
  })

  it('scopes template overrides by theme and path', () => {
    const templates = model.tables.find((table) => table.name === 'theme_templates')
    expect(templates?.uniques).toEqual([{ columns: ['theme', 'path'] }])
  })

  it('gives every cache-relevant content table a revision column', () => {
    for (const name of ['pages', 'posts', 'products', 'theme_templates']) {
      const table = model.tables.find((candidate) => candidate.name === name)
      expect(table?.columns.map((column) => column.name)).toContain('revision')
    }
  })
})
