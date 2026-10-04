import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../contracts'
import { createD1Repositories } from '.'
import { createTestDatabase } from '../testing'

function setup() {
  const db = createTestDatabase()
  const repositories = createD1Repositories(db)
  return { db, vocabularies: repositories.vocabularies, terms: repositories.terms }
}

const ctx = defaultContext()

/** A vocabulary bound to posts, which is what most of these cases need. */
async function withVocabulary(contentTypes: Array<'post' | 'product'> = ['post']) {
  const repositories = setup()
  const vocabulary = await repositories.vocabularies.upsert(ctx, { name: 'Categories', contentTypes })
  return { ...repositories, vocabulary }
}

describe('term repository', () => {
  it('creates a root term and appends its siblings in order', async () => {
    const { terms, vocabulary } = await withVocabulary()

    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })
    const guides = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'Guides', slug: 'guides' })

    expect(news.parentId).toBeNull()
    expect(news.sortOrder).toBe(0)
    expect(guides.sortOrder).toBe(1)
  })

  it('nests a term under a parent and orders it among its siblings', async () => {
    const { terms, vocabulary } = await withVocabulary()
    const engineering = await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      name: 'Engineering',
      slug: 'engineering',
    })

    const frontend = await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      parentId: engineering.id,
      name: 'Frontend',
      slug: 'frontend',
    })
    const backend = await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      parentId: engineering.id,
      name: 'Backend',
      slug: 'backend',
    })

    expect(frontend.parentId).toBe(engineering.id)
    expect(frontend.sortOrder).toBe(0)
    expect(backend.sortOrder).toBe(1)
  })

  it('assembles the tree, not just the list', async () => {
    const { terms, vocabulary } = await withVocabulary()
    const engineering = await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      name: 'Engineering',
      slug: 'engineering',
    })
    await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      parentId: engineering.id,
      name: 'Frontend',
      slug: 'frontend',
    })
    await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    const tree = await terms.tree(ctx, vocabulary.id)

    expect(tree.map((node) => node.name)).toEqual(['Engineering', 'News'])
    expect(tree[0]?.children.map((node) => node.name)).toEqual(['Frontend'])
    expect(tree[1]?.children).toEqual([])
  })

  it('lists depth first, so children sit under their parent', async () => {
    const { terms, vocabulary } = await withVocabulary()
    const engineering = await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      name: 'Engineering',
      slug: 'engineering',
    })
    await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      parentId: engineering.id,
      name: 'Frontend',
      slug: 'frontend',
    })
    await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    expect((await terms.list(ctx, vocabulary.id)).map((term) => term.name)).toEqual([
      'Engineering',
      'Frontend',
      'News',
    ])
  })

  it('reports a path from the root down to the term', async () => {
    const { terms, vocabulary } = await withVocabulary()
    const engineering = await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      name: 'Engineering',
      slug: 'engineering',
    })
    const frontend = await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      parentId: engineering.id,
      name: 'Frontend',
      slug: 'frontend',
    })
    const css = await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      parentId: frontend.id,
      name: 'CSS',
      slug: 'css',
    })

    expect((await terms.path(ctx, css.id)).map((term) => term.name)).toEqual([
      'Engineering',
      'Frontend',
      'CSS',
    ])
    expect((await terms.path(ctx, engineering.id)).map((term) => term.name)).toEqual(['Engineering'])
    expect(await terms.path(ctx, 'missing')).toEqual([])
  })

  it('renames a term in place and keeps its position', async () => {
    const { db, terms, vocabulary } = await withVocabulary()
    const created = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'Old', slug: 'old' })

    const renamed = await terms.upsert(ctx, {
      id: created.id,
      vocabularyId: vocabulary.id,
      name: 'New',
      slug: 'new',
    })

    expect(renamed.id).toBe(created.id)
    expect(renamed.name).toBe('New')
    expect(renamed.sortOrder).toBe(created.sortOrder)
    const count = await db.first<{ total: number }>('SELECT count(*) AS total FROM terms')
    expect(count?.total).toBe(1)
  })

  it('refuses a parent that belongs to another vocabulary', async () => {
    const { terms, vocabularies, vocabulary } = await withVocabulary()
    const other = await vocabularies.upsert(ctx, { name: 'Topics', contentTypes: ['post'] })
    const foreign = await terms.upsert(ctx, { vocabularyId: other.id, name: 'Topic', slug: 'topic' })

    await expect(
      terms.upsert(ctx, {
        vocabularyId: vocabulary.id,
        parentId: foreign.id,
        name: 'Child',
        slug: 'child',
      }),
    ).rejects.toThrow('another vocabulary')
  })

  it('refuses a parent that does not exist', async () => {
    const { terms, vocabulary } = await withVocabulary()

    await expect(
      terms.upsert(ctx, {
        vocabularyId: vocabulary.id,
        parentId: '01920000-0000-7000-8000-000000000000',
        name: 'Child',
        slug: 'child',
      }),
    ).rejects.toThrow('does not exist')
  })

  it('refuses to move a term under its own descendant', async () => {
    const { terms, vocabulary } = await withVocabulary()
    const parent = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'Parent', slug: 'parent' })
    const child = await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      parentId: parent.id,
      name: 'Child',
      slug: 'child',
    })

    await expect(
      terms.upsert(ctx, {
        id: parent.id,
        vocabularyId: vocabulary.id,
        parentId: child.id,
        name: 'Parent',
        slug: 'parent',
      }),
    ).rejects.toThrow('descendant')
  })

  it('keeps a slug unique inside its vocabulary but not across vocabularies', async () => {
    const { terms, vocabularies, vocabulary } = await withVocabulary()
    const other = await vocabularies.upsert(ctx, { name: 'Topics' })
    await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    await expect(
      terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News again', slug: 'news' }),
    ).rejects.toThrow()

    const allowed = await terms.upsert(ctx, { vocabularyId: other.id, name: 'News', slug: 'news' })
    expect(allowed.slug).toBe('news')
  })

  it('removes a branch: the term and everything under it', async () => {
    const { terms, vocabulary } = await withVocabulary()
    const parent = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'Parent', slug: 'parent' })
    await terms.upsert(ctx, {
      vocabularyId: vocabulary.id,
      parentId: parent.id,
      name: 'Child',
      slug: 'child',
    })

    expect(await terms.remove(ctx, parent.id)).toBe(true)
    expect(await terms.remove(ctx, parent.id)).toBe(false)
    expect(await terms.list(ctx, vocabulary.id)).toEqual([])
  })

  it('counts how much content carries a term', async () => {
    const { terms, vocabulary } = await withVocabulary()
    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    expect(await terms.usage(ctx, news.id)).toBe(0)

    await terms.assign(ctx, 'post', 'post-1', [news.id])
    await terms.assign(ctx, 'post', 'post-2', [news.id])

    expect(await terms.usage(ctx, news.id)).toBe(2)
  })

  it('forgets its assignments when the term goes', async () => {
    const { db, terms, vocabulary } = await withVocabulary()
    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })
    await terms.assign(ctx, 'post', 'post-1', [news.id])

    await terms.remove(ctx, news.id)

    const left = await db.first<{ total: number }>('SELECT count(*) AS total FROM content_terms')
    expect(left?.total).toBe(0)
  })

  it('reads back the terms of a piece of content, vocabulary by vocabulary', async () => {
    const { terms, vocabularies, vocabulary } = await withVocabulary(['post', 'product'])
    const other = await vocabularies.upsert(ctx, { name: 'Topics', sortOrder: 1, contentTypes: ['post'] })
    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })
    const css = await terms.upsert(ctx, { vocabularyId: other.id, name: 'CSS', slug: 'css' })

    await terms.assign(ctx, 'post', 'post-1', [css.id, news.id])

    expect((await terms.forContent(ctx, 'post', 'post-1')).map((term) => term.name)).toEqual([
      'News',
      'CSS',
    ])
    expect(await terms.forContent(ctx, 'post', 'post-2')).toEqual([])
    expect(await terms.forContent(ctx, 'product', 'post-1')).toEqual([])
  })

  it('replaces the set rather than adding to it', async () => {
    const { terms, vocabulary } = await withVocabulary(['post', 'product'])
    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })
    const guides = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'Guides', slug: 'guides' })

    await terms.assign(ctx, 'post', 'post-1', [news.id, guides.id])
    await terms.assign(ctx, 'post', 'post-1', [guides.id])

    expect((await terms.forContent(ctx, 'post', 'post-1')).map((term) => term.name)).toEqual(['Guides'])
  })

  it('stores a repeated term once', async () => {
    const { db, terms, vocabulary } = await withVocabulary()
    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    await terms.assign(ctx, 'post', 'post-1', [news.id, news.id])

    const count = await db.first<{ total: number }>('SELECT count(*) AS total FROM content_terms')
    expect(count?.total).toBe(1)
  })

  it('clears every term when assigned an empty set', async () => {
    const { terms, vocabulary } = await withVocabulary()
    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })
    await terms.assign(ctx, 'post', 'post-1', [news.id])

    await terms.assign(ctx, 'post', 'post-1', [])

    expect(await terms.forContent(ctx, 'post', 'post-1')).toEqual([])
  })

  it('refuses a term whose vocabulary does not apply to the content type', async () => {
    const { terms, vocabulary } = await withVocabulary(['post'])
    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    await expect(terms.assign(ctx, 'product', 'product-1', [news.id])).rejects.toThrow(
      'does not apply to product',
    )
  })

  it('refuses a term that does not exist', async () => {
    const { terms } = await withVocabulary()

    await expect(
      terms.assign(ctx, 'post', 'post-1', ['01920000-0000-7000-8000-000000000000']),
    ).rejects.toThrow()
  })
})

describe('the term archive queries', () => {
  it('finds a term by slug, or nothing', async () => {
    const db = createTestDatabase()
    const { terms, vocabularies } = createD1Repositories(db)
    const vocabulary = await vocabularies.upsert(ctx, { name: 'Categories', contentTypes: ['post'] })
    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    expect((await terms.bySlug(ctx, 'news'))?.id).toBe(news.id)
    expect(await terms.bySlug(ctx, 'ghost')).toBeNull()
    expect(await terms.bySlug(ctx, '')).toBeNull()
  })

  it('lists published posts and products carrying the term, and leaves drafts out', async () => {
    const db = createTestDatabase()
    const { terms, vocabularies, posts, products } = createD1Repositories(db)
    const vocabulary = await vocabularies.upsert(ctx, {
      name: 'Categories',
      contentTypes: ['post', 'product'],
    })
    const news = await terms.upsert(ctx, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    const one = await posts.upsert(ctx, { title: 'One', slug: 'one', status: 'published' })
    const two = await posts.upsert(ctx, { title: 'Two', slug: 'two', status: 'published' })
    const draft = await posts.upsert(ctx, { title: 'Draft', slug: 'draft', status: 'draft' })
    const widget = await products.upsert(ctx, { title: 'Widget', slug: 'widget', status: 'published' })

    await terms.assign(ctx, 'post', one.id, [news.id])
    await terms.assign(ctx, 'post', two.id, [news.id])
    await terms.assign(ctx, 'post', draft.id, [news.id])
    await terms.assign(ctx, 'product', widget.id, [news.id])

    const listing = await terms.content(ctx, news.id, { limit: 10, offset: 0 })

    expect(listing.total).toBe(3)
    expect(new Set(listing.items.map((item) => item.id))).toEqual(new Set([one.id, two.id, widget.id]))
    // Newest first, and a draft is not an archive entry.
    expect(listing.items.some((item) => item.id === draft.id)).toBe(false)
    expect(listing.items.map((item) => item.contentType).sort()).toEqual(['post', 'post', 'product'])
  })
})
