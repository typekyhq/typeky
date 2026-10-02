import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../contracts'
import { createD1Repositories } from '.'
import { createTestDatabase } from '../testing'

function setup() {
  const db = createTestDatabase()
  return { db, posts: createD1Repositories(db).posts }
}

const ctx = defaultContext()

describe('post repository', () => {
  it('creates a draft with the documented defaults', async () => {
    const { posts } = setup()

    const post = await posts.upsert(ctx, { title: 'Hello', slug: 'hello' })

    expect(post.status).toBe('draft')
    expect(post.revision).toBe(1)
    expect(post.publishedAt).toBeNull()
    expect(post.excerpt).toBeNull()
    expect(post.coverMediaId).toBeNull()
    expect(post.category).toBeNull()
    expect(post.tags).toEqual([])
    expect(post.blocks).toEqual([])
  })

  it('round-trips tags, category, excerpt and blocks', async () => {
    const { posts } = setup()

    const created = await posts.upsert(ctx, {
      title: 'Hello',
      slug: 'hello',
      excerpt: 'The first post',
      tags: ['getting-started', 'news'],
      category: 'News',
      blocks: [{ id: 'blk_1', type: 'paragraph', text: 'Body' }],
      seo: { description: 'A first post' },
    })

    const read = await posts.byId(ctx, created.id)
    expect(read?.tags).toEqual(['getting-started', 'news'])
    expect(read?.category).toBe('News')
    expect(read?.excerpt).toBe('The first post')
    expect(read?.blocks).toEqual([{ id: 'blk_1', type: 'paragraph', text: 'Body' }])
    expect(read?.seo).toEqual({ description: 'A first post' })
  })

  it('updates in place, bumps revision and preserves created_at', async () => {
    const db = createTestDatabase()
    const { posts } = createD1Repositories(db)

    const created = await posts.upsert(ctx, { title: 'Hello', slug: 'hello' })
    const updated = await posts.upsert(ctx, { id: created.id, title: 'Hello again', slug: 'hello' })

    expect(updated.id).toBe(created.id)
    expect(updated.createdAt).toEqual(created.createdAt)
    expect(updated.revision).toBe(2)

    const count = await db.first<{ total: number }>('SELECT count(*) AS total FROM posts')
    expect(count?.total).toBe(1)
  })

  it('finds posts by slug', async () => {
    const { posts } = setup()
    await posts.upsert(ctx, { title: 'Hello', slug: 'hello' })

    expect((await posts.bySlug(ctx, 'hello'))?.title).toBe('Hello')
    expect(await posts.bySlug(ctx, 'nope')).toBeNull()
  })

  it('lists newest published first and keeps drafts at the end', async () => {
    const { posts } = setup()
    await posts.upsert(ctx, { title: 'Older', slug: 'older', status: 'published' })
    await posts.upsert(ctx, { title: 'Newer', slug: 'newer', status: 'published' })
    await posts.upsert(ctx, { title: 'Draft', slug: 'draft' })

    const listed = await posts.list(ctx)

    expect(listed.total).toBe(3)
    expect(listed.items.map((post) => post.slug)).toEqual(['newer', 'older', 'draft'])
  })

  it('filters by status and category together', async () => {
    const { posts } = setup()
    await posts.upsert(ctx, { title: 'A', slug: 'a', status: 'published', category: 'News' })
    await posts.upsert(ctx, { title: 'B', slug: 'b', status: 'published', category: 'Guides' })
    await posts.upsert(ctx, { title: 'C', slug: 'c', category: 'News' })

    const news = await posts.list(ctx, { status: 'published', category: 'News' })

    expect(news.total).toBe(1)
    expect(news.items[0]?.slug).toBe('a')
  })

  it('reports whether a delete removed anything', async () => {
    const { posts } = setup()
    const post = await posts.upsert(ctx, { title: 'Hello', slug: 'hello' })

    expect(await posts.remove(ctx, post.id)).toBe(true)
    expect(await posts.remove(ctx, post.id)).toBe(false)
  })
})
