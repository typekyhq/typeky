import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../contracts'
import { createD1Repositories } from '.'
import { createTestDatabase } from '../testing'

function setup() {
  const db = createTestDatabase()
  return { db, products: createD1Repositories(db).products }
}

const ctx = defaultContext()

describe('product repository', () => {
  it('creates a draft with empty collections, not nulls', async () => {
    const { products } = setup()

    const product = await products.upsert(ctx, { title: 'Widget', slug: 'widget' })

    expect(product.status).toBe('draft')
    expect(product.gallery).toEqual([])
    expect(product.specs).toEqual([])
    expect(product.summary).toBeNull()
    expect(product.priceLabel).toBeNull()
    expect(product.ctaLabel).toBeNull()
    expect(product.ctaUrl).toBeNull()
    expect(product.revision).toBe(1)
  })

  it('round-trips the gallery and the spec list', async () => {
    const { products } = setup()

    const created = await products.upsert(ctx, {
      title: 'Widget',
      slug: 'widget',
      gallery: ['media_1', 'media_2'],
      specs: [
        { label: 'Material', value: 'Recycled aluminium' },
        { label: 'Warranty', value: '2 years' },
      ],
      priceLabel: 'From 199 USD',
      ctaLabel: 'Talk to us',
      ctaUrl: 'https://example.com/contact',
    })

    const read = await products.byId(ctx, created.id)
    expect(read?.gallery).toEqual(['media_1', 'media_2'])
    expect(read?.specs).toEqual([
      { label: 'Material', value: 'Recycled aluminium' },
      { label: 'Warranty', value: '2 years' },
    ])
    expect(read?.priceLabel).toBe('From 199 USD')
    expect(read?.ctaUrl).toBe('https://example.com/contact')
  })

  it('updates in place, bumps revision and preserves created_at', async () => {
    const db = createTestDatabase()
    const { products } = createD1Repositories(db)

    const created = await products.upsert(ctx, { title: 'Widget', slug: 'widget' })
    const updated = await products.upsert(ctx, { id: created.id, title: 'Widget v2', slug: 'widget' })

    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toEqual(created.createdAt)
    expect(updated.revision).toBe(2)

    const count = await db.first<{ total: number }>('SELECT count(*) AS total FROM products')
    expect(count?.total).toBe(1)
  })

  it('finds products by slug', async () => {
    const { products } = setup()
    await products.upsert(ctx, { title: 'Widget', slug: 'widget' })

    expect((await products.bySlug(ctx, 'widget'))?.title).toBe('Widget')
    expect(await products.bySlug(ctx, 'nope')).toBeNull()
  })

  it('orders the list by the explicit sort_order', async () => {
    const { products } = setup()
    await products.upsert(ctx, { title: 'Third', slug: 'third', sortOrder: 3 })
    await products.upsert(ctx, { title: 'First', slug: 'first', sortOrder: 1 })
    await products.upsert(ctx, { title: 'Second', slug: 'second', sortOrder: 2 })

    const listed = await products.list(ctx)

    expect(listed.items.map((product) => product.slug)).toEqual(['first', 'second', 'third'])
  })

  it('filters by status', async () => {
    const { products } = setup()
    await products.upsert(ctx, { title: 'A', slug: 'a', status: 'published' })
    await products.upsert(ctx, { title: 'B', slug: 'b' })

    const published = await products.list(ctx, { status: 'published' })

    expect(published.total).toBe(1)
    expect(published.items[0]?.slug).toBe('a')
  })

  it('reports whether a delete removed anything', async () => {
    const { products } = setup()
    const product = await products.upsert(ctx, { title: 'Widget', slug: 'widget' })

    expect(await products.remove(ctx, product.id)).toBe(true)
    expect(await products.remove(ctx, product.id)).toBe(false)
  })

  it('searches title, slug and summary, and combines that with a status filter', async () => {
    const { products } = setup()
    await products.upsert(ctx, {
      title: 'Desk lamp',
      slug: 'desk-lamp',
      summary: 'A lamp for a small desk',
      status: 'published',
    })
    await products.upsert(ctx, { title: 'Floor lamp', slug: 'floor-lamp' })
    await products.upsert(ctx, { title: 'Chair', slug: 'chair' })

    const byTitle = await products.list(ctx, { search: 'desk' })
    const bySummary = await products.list(ctx, { search: 'SMALL desk' })
    const withStatus = await products.list(ctx, { search: 'lamp', status: 'published' })

    expect(byTitle.items.map((product) => product.slug)).toEqual(['desk-lamp'])
    expect(bySummary.items.map((product) => product.slug)).toEqual(['desk-lamp'])
    expect(withStatus.items.map((product) => product.slug)).toEqual(['desk-lamp'])
  })

  it('treats a percent sign in a search term as a character', async () => {
    const { products } = setup()
    await products.upsert(ctx, { title: '50% off bundle', slug: 'bundle' })
    await products.upsert(ctx, { title: '50 items', slug: 'fifty' })

    expect((await products.list(ctx, { search: '50%' })).items.map((p) => p.slug)).toEqual(['bundle'])
  })
})
