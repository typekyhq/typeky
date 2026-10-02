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
      blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
      seo: { description: 'A first post' },
    })

    const read = await posts.byId(ctx, created.id)
    expect(read?.tags).toEqual(['getting-started', 'news'])
    expect(read?.category).toBe('News')
    expect(read?.excerpt).toBe('The first post')
    expect(read?.blocks).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }])
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

  it('searches title, slug and excerpt without regard to case', async () => {
    const { posts } = setup()
    await posts.upsert(ctx, { title: 'Deploying with Workers', slug: 'deploying', excerpt: 'Edge notes' })
    await posts.upsert(ctx, { title: 'Something else', slug: 'something-else', excerpt: 'About a WORKER pool' })
    await posts.upsert(ctx, { title: 'Unrelated', slug: 'unrelated' })

    const byTitle = await posts.list(ctx, { search: 'deploying' })
    expect(byTitle.items.map((post) => post.slug)).toEqual(['deploying'])

    const byExcerpt = await posts.list(ctx, { search: 'worker' })
    expect(byExcerpt.items.map((post) => post.slug).sort()).toEqual(['deploying', 'something-else'])

    const bySlug = await posts.list(ctx, { search: 'unrelated' })
    expect(bySlug.items.map((post) => post.slug)).toEqual(['unrelated'])
  })

  it('treats a percent sign in a search term as a character, not a wildcard', async () => {
    const { posts } = setup()
    await posts.upsert(ctx, { title: '100% cotton', slug: 'cotton' })
    await posts.upsert(ctx, { title: '100 things', slug: 'things' })

    const found = await posts.list(ctx, { search: '100%' })

    // Without escaping this matches everything, and the operator gets a
    // confident wrong answer rather than an error.
    expect(found.items.map((post) => post.slug)).toEqual(['cotton'])
  })

  it('treats an underscore the same way', async () => {
    const { posts } = setup()
    await posts.upsert(ctx, { title: 'file_name', slug: 'underscore' })
    await posts.upsert(ctx, { title: 'fileXname', slug: 'other' })

    const found = await posts.list(ctx, { search: 'file_name' })

    expect(found.items.map((post) => post.slug)).toEqual(['underscore'])
  })

  it('combines a search with a status filter and counts only what matches', async () => {
    const { posts } = setup()
    await posts.upsert(ctx, { title: 'Release notes', slug: 'release-notes', status: 'published' })
    await posts.upsert(ctx, { title: 'Release plan', slug: 'release-plan' })

    const found = await posts.list(ctx, { search: 'release', status: 'published' })

    expect(found.total).toBe(1)
    expect(found.items[0]?.slug).toBe('release-notes')
  })

  it('ignores a blank search rather than matching nothing', async () => {
    const { posts } = setup()
    await posts.upsert(ctx, { title: 'Hello', slug: 'hello' })

    expect((await posts.list(ctx, { search: '   ' })).total).toBe(1)
  })
})
