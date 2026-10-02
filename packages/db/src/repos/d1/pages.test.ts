import type { Block } from '@typeky/core'
import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../contracts'
import { createD1Repositories } from '.'
import { createTestDatabase } from '../testing'

function setup() {
  const db = createTestDatabase()
  return { db, pages: createD1Repositories(db).pages }
}

const ctx = defaultContext()

describe('page repository', () => {
  it('creates a page with the documented defaults', async () => {
    const { pages } = setup()

    const page = await pages.upsert(ctx, { title: 'About', slug: 'about' })

    expect(page.status).toBe('draft')
    expect(page.isHome).toBe(false)
    expect(page.sortOrder).toBe(0)
    expect(page.revision).toBe(1)
    expect(page.publishedAt).toBeNull()
    expect(page.blocks).toEqual([])
    expect(page.seo).toEqual({})
    expect(page.createdAt).toBeInstanceOf(Date)
  })

  it('round-trips blocks and SEO metadata through their JSON columns', async () => {
    const { pages } = setup()
    const blocks: Block[] = [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }]

    const created = await pages.upsert(ctx, {
      title: 'About',
      slug: 'about',
      blocks,
      seo: { title: 'About us', description: 'Who we are' },
    })

    const read = await pages.byId(ctx, created.id)
    expect(read?.blocks).toEqual(blocks)
    expect(read?.seo).toEqual({ title: 'About us', description: 'Who we are' })
  })

  it('finds pages by slug', async () => {
    const { pages } = setup()
    await pages.upsert(ctx, { title: 'Contact', slug: 'contact' })

    expect((await pages.bySlug(ctx, 'contact'))?.title).toBe('Contact')
    expect(await pages.bySlug(ctx, 'missing')).toBeNull()
  })

  it('updates in place, bumps revision and preserves created_at', async () => {
    const db = createTestDatabase()
    const { pages } = createD1Repositories(db)

    const created = await pages.upsert(ctx, { title: 'About', slug: 'about' })
    const updated = await pages.upsert(ctx, { id: created.id, title: 'About us', slug: 'about' })

    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toEqual(created.createdAt)
    expect(updated.revision).toBe(2)
    expect(updated.title).toBe('About us')

    const count = await db.first<{ total: number }>('SELECT count(*) AS total FROM pages')
    expect(count?.total).toBe(1)
  })

  it('stamps published_at on publish and clears it on unpublish', async () => {
    const { pages } = setup()

    const published = await pages.upsert(ctx, { title: 'About', slug: 'about', status: 'published' })
    expect(published.publishedAt).toBeInstanceOf(Date)

    const stillPublished = await pages.upsert(ctx, { id: published.id, title: 'About', slug: 'about', status: 'published' })
    expect(stillPublished.publishedAt).toEqual(published.publishedAt)

    const draft = await pages.upsert(ctx, { id: published.id, title: 'About', slug: 'about', status: 'draft' })
    expect(draft.publishedAt).toBeNull()
  })

  it('lists by status with a total and a clamped window', async () => {
    const { pages } = setup()
    await pages.upsert(ctx, { title: 'A', slug: 'a', status: 'published', sortOrder: 2 })
    await pages.upsert(ctx, { title: 'B', slug: 'b', status: 'published', sortOrder: 1 })
    await pages.upsert(ctx, { title: 'C', slug: 'c' })

    const published = await pages.list(ctx, { status: 'published' })
    expect(published.total).toBe(2)
    expect(published.items.map((page) => page.slug)).toEqual(['b', 'a'])

    const all = await pages.list(ctx)
    expect(all.total).toBe(3)
    expect(all.limit).toBe(20)
    expect(all.offset).toBe(0)

    const secondPage = await pages.list(ctx, { limit: 2, offset: 2 })
    expect(secondPage.items).toHaveLength(1)
    expect(secondPage.total).toBe(3)
  })

  it('caps an oversized limit instead of loading everything', async () => {
    const { pages } = setup()

    expect((await pages.list(ctx, { limit: 5000 })).limit).toBe(100)
    expect((await pages.list(ctx, { limit: 0 })).limit).toBe(1)
  })

  it('moves the home flag between pages so exactly one remains', async () => {
    const { pages } = setup()
    const first = await pages.upsert(ctx, { title: 'First', slug: 'first' })
    const second = await pages.upsert(ctx, { title: 'Second', slug: 'second' })

    await pages.setHome(ctx, first.id)
    expect((await pages.home(ctx))?.id).toBe(first.id)

    await pages.setHome(ctx, second.id)
    expect((await pages.home(ctx))?.id).toBe(second.id)
    expect((await pages.byId(ctx, first.id))?.isHome).toBe(false)
  })

  it('refuses to make a missing page the home page', async () => {
    const { pages } = setup()

    await expect(pages.setHome(ctx, 'missing')).rejects.toThrow(/not found/)
  })

  it('reports whether a delete removed anything', async () => {
    const { pages } = setup()
    const page = await pages.upsert(ctx, { title: 'About', slug: 'about' })

    expect(await pages.remove(ctx, page.id)).toBe(true)
    expect(await pages.remove(ctx, page.id)).toBe(false)
    expect(await pages.byId(ctx, page.id)).toBeNull()
  })
})
