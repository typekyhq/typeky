import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../contracts'
import { createD1Repositories } from '.'
import { createTestDatabase } from '../testing'

function setup() {
  const db = createTestDatabase()
  return { db, vocabularies: createD1Repositories(db).vocabularies, terms: createD1Repositories(db).terms }
}

const ctx = defaultContext()

describe('vocabulary repository', () => {
  it('starts empty', async () => {
    const { vocabularies } = setup()

    expect(await vocabularies.list(ctx)).toEqual([])
    expect(await vocabularies.byId(ctx, 'missing')).toBeNull()
  })

  it('creates a vocabulary, defaulting its content types to none', async () => {
    const { vocabularies } = setup()

    const saved = await vocabularies.upsert(ctx, { name: 'Categories' })

    expect(saved.name).toBe('Categories')
    expect(saved.contentTypes).toEqual([])
    expect(saved.sortOrder).toBe(0)
    expect(saved.createdAt).toBeInstanceOf(Date)
    expect(saved.updatedAt).toBeInstanceOf(Date)
  })

  it('reads back the content types it was given', async () => {
    const { vocabularies } = setup()

    const saved = await vocabularies.upsert(ctx, {
      name: 'Categories',
      description: 'For posts',
      contentTypes: ['post', 'product'],
    })

    expect(saved.contentTypes).toEqual(['post', 'product'])
    expect(saved.description).toBe('For posts')
  })

  it('drops an unknown content type rather than offering something unrenderable', async () => {
    const { db, vocabularies } = setup()
    const id = '01920000-0000-7000-8000-000000000000'

    // Written straight past the repository, which is the only way a row from a
    // newer build could arrive.
    await db.run(
      `INSERT INTO vocabularies (id, name, description, content_types, sort_order, created_at, updated_at)
       VALUES (?, ?, NULL, ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      [id, 'Legacy', '["post","event"]'],
    )

    expect((await vocabularies.byId(ctx, id))?.contentTypes).toEqual(['post'])
  })

  it('lists by sort order, then name', async () => {
    const { vocabularies } = setup()
    await vocabularies.upsert(ctx, { name: 'Topics', sortOrder: 2 })
    await vocabularies.upsert(ctx, { name: 'Categories', sortOrder: 1 })
    await vocabularies.upsert(ctx, { name: 'Zebra', sortOrder: 1 })

    expect((await vocabularies.list(ctx)).map((entry) => entry.name)).toEqual([
      'Categories',
      'Zebra',
      'Topics',
    ])
  })

  it('appends a new vocabulary to the end', async () => {
    const { vocabularies } = setup()
    await vocabularies.upsert(ctx, { name: 'First' })
    const second = await vocabularies.upsert(ctx, { name: 'Second' })

    expect(second.sortOrder).toBe(1)
  })

  it('renames in place without touching the sort order', async () => {
    const { db, vocabularies } = setup()
    const first = await vocabularies.upsert(ctx, { name: 'Old' })

    const renamed = await vocabularies.upsert(ctx, { id: first.id, name: 'New' })

    expect(renamed.id).toBe(first.id)
    expect(renamed.name).toBe('New')
    const count = await db.first<{ total: number }>('SELECT count(*) AS total FROM vocabularies')
    expect(count?.total).toBe(1)
  })

  it('refuses a second vocabulary with the same name', async () => {
    const { vocabularies } = setup()
    await vocabularies.upsert(ctx, { name: 'Categories' })

    await expect(vocabularies.upsert(ctx, { name: 'Categories' })).rejects.toThrow()
  })

  it('finds the vocabularies that apply to a content type', async () => {
    const { vocabularies } = setup()
    await vocabularies.upsert(ctx, { name: 'Categories', contentTypes: ['post'] })
    await vocabularies.upsert(ctx, { name: 'Product types', contentTypes: ['product'] })
    await vocabularies.upsert(ctx, { name: 'Unused' })

    expect((await vocabularies.forContentType(ctx, 'post')).map((entry) => entry.name)).toEqual([
      'Categories',
    ])
    expect((await vocabularies.forContentType(ctx, 'product')).map((entry) => entry.name)).toEqual([
      'Product types',
    ])
  })

  it('does not match a content type inside another one', async () => {
    const { vocabularies } = setup()
    // `"product"` contains the substring `post`. A LIKE over the raw JSON would
    // hand a post-only vocabulary to the product form.
    await vocabularies.upsert(ctx, { name: 'Product types', contentTypes: ['product'] })

    expect(await vocabularies.forContentType(ctx, 'post')).toEqual([])
  })

  it('removes the vocabulary and every term in it', async () => {
    const { vocabularies, terms } = setup()
    const vocabulary = await vocabularies.upsert(ctx, { name: 'Categories', contentTypes: ['post'] })
    await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    expect(await vocabularies.remove(ctx, vocabulary.id)).toBe(true)
    expect(await vocabularies.remove(ctx, vocabulary.id)).toBe(false)
    expect(await terms.list(ctx, vocabulary.id)).toEqual([])
  })
})
