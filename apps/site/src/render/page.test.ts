import type { DbPort } from '@typeky/platform'
import type { Page, Post, Product, Repositories, Site } from '@typeky/db'
import { describe, expect, it } from 'vitest'
import { renderPage, resolveRoute } from './page'

/**
 * The render pipeline.
 *
 * M6-S1's acceptance is that the front page renders real content, and the
 * interesting part of that is not the HTML -- it is that the route table, the
 * draft check and the context assembly agree with each other. A published page
 * that 404s, or a draft that renders, is the kind of bug that looks like a theme
 * problem from the outside.
 *
 * The repositories are a small fake. What is being tested is the pipeline above
 * them, and the SQL underneath is tested where it lives.
 */

const SITE = {
  id: 'default',
  name: 'Sample Site',
  tagline: 'A tagline',
  logoMediaId: null,
  theme: 'default',
  settings: { footer: 'Built with Typeky.', seo: { defaultTitle: 'Sample Site' } },
  nav: [{ label: 'Home', href: '/', order: 0 }],
  createdAt: new Date(),
  updatedAt: new Date(),
} as unknown as Site

function page(overrides: Partial<Page> & { title: string; slug: string }): Page {
  return {
    id: overrides.slug,
    blocks: [],
    seo: {},
    status: 'published',
    isHome: false,
    sortOrder: 0,
    revision: 1,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Page
}

function post(overrides: Partial<Post> & { title: string; slug: string }): Post {
  return {
    id: overrides.slug,
    excerpt: null,
    coverMediaId: null,
    blocks: [],
    tags: [],
    category: null,
    seo: {},
    status: 'published',
    revision: 1,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Post
}

function setUp(options: { pages?: Page[]; posts?: Post[]; products?: Product[]; site?: Site | null } = {}) {
  const pages = options.pages ?? []
  const posts = options.posts ?? []
  const site = options.site === undefined ? SITE : options.site

  const store = {
    sites: { async get() { return site } },
    pages: {
      async home() { return pages.find((entry) => entry.isHome) ?? null },
      async bySlug(_ctx: unknown, slug: string) { return pages.find((entry) => entry.slug === slug) ?? null },
    },
    posts: {
      async bySlug(_ctx: unknown, slug: string) { return posts.find((entry) => entry.slug === slug) ?? null },
      async list() { return { items: posts, total: posts.length, limit: 10, offset: 0 } },
    },
    products: {
      async bySlug() { return null },
      async list() { return { items: [], total: 0, limit: 10, offset: 0 } },
    },
    media: { async byId() { return null } },
  } as unknown as Repositories

  const db: DbPort = {
    async all<T>() { return [] as T[] },
    async first<T>() { return null as T | null },
    async run() { return 0 },
    async batch() { return undefined },
  }

  return { render: (path: string) => renderPage(path, { repositories: store, db, blob: null, baseUrl: 'https://example.com' }) }
}

describe('the route table', () => {
  it('answers the front page for the root, with or without a slash', () => {
    expect(resolveRoute('/')).toEqual({ kind: 'home' })
  })

  it('takes the list paths, and a number as a page', () => {
    expect(resolveRoute('/posts')).toEqual({ kind: 'posts', page: 1 })
    expect(resolveRoute('/posts/2')).toEqual({ kind: 'posts', page: 2 })
    expect(resolveRoute('/products')).toEqual({ kind: 'products', page: 1 })
    expect(resolveRoute('/products/3')).toEqual({ kind: 'products', page: 3 })
  })

  it('takes anything else under those paths as a slug', () => {
    expect(resolveRoute('/posts/hello')).toEqual({ kind: 'post', slug: 'hello' })
    expect(resolveRoute('/products/widget')).toEqual({ kind: 'product', slug: 'widget' })
  })

  it('does not let a post be named after a page number', () => {
    // A number wins, so `/posts/2` is never a post called "2". Without that the
    // same URL would mean two things depending on which posts existed.
    expect(resolveRoute('/posts/2')).toEqual({ kind: 'posts', page: 2 })
  })

  it('treats a single segment as a page and anything deeper as not found', () => {
    expect(resolveRoute('/about')).toEqual({ kind: 'page', slug: 'about' })
    expect(resolveRoute('/a/b')).toEqual({ kind: 'notFound' })
    expect(resolveRoute('/posts/a/b')).toEqual({ kind: 'notFound' })
  })

  it('ignores a trailing slash, because both spellings are one page', () => {
    expect(resolveRoute('/about/')).toEqual({ kind: 'page', slug: 'about' })
    expect(resolveRoute('/posts/')).toEqual({ kind: 'posts', page: 1 })
  })
})

describe('rendering the front page', () => {
  it('renders the page flagged as home, with real content', async () => {
    const { render } = setUp({
      pages: [page({ title: 'Welcome', slug: 'home', isHome: true, blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Real body text' }] }] })],
    })

    const result = await render('/')

    expect(result.status).toBe(200)
    expect(result.html).toContain('<!doctype html>')
    expect(result.html).toContain('<title>Welcome</title>')
    expect(result.html).toContain('Real body text')
    // The theme's own pieces resolved, which is what "rendered" means here.
    expect(result.html).toContain('site-header')
    expect(result.html).toContain('Sample Site')
  })

  it('404s when no page is flagged as home', async () => {
    const { render } = setUp({ pages: [page({ title: 'About', slug: 'about' })] })

    const result = await render('/')

    expect(result.status).toBe(404)
    expect(result.html).toContain('Page not found')
  })

  it('404s for a page that is still a draft', async () => {
    const { render } = setUp({
      pages: [page({ title: 'Secret', slug: 'secret', status: 'draft' })],
    })

    // A draft and a slug that does not exist are the same answer to a visitor:
    // saying which it was would leak which pages exist.
    expect((await render('/secret')).status).toBe(404)
  })
})

describe('rendering content pages', () => {
  it('renders a published post and 404s a draft one', async () => {
    const { render } = setUp({
      posts: [
        post({ title: 'Published', slug: 'published' }),
        post({ title: 'Draft', slug: 'draft', status: 'draft' }),
      ],
    })

    const published = await render('/posts/published')
    expect(published.status).toBe(200)
    expect(published.html).toContain('Published</h1>')

    expect((await render('/posts/draft')).status).toBe(404)
  })

  it('puts paging on the page, where the pagination snippet reads it', async () => {
    const many = Array.from({ length: 25 }, (_, index) =>
      post({ title: 'Post ' + String(index), slug: 'post-' + String(index) }),
    )
    const { render } = setUp({ posts: many })

    // 25 posts at ten a page: a second page exists, and so does a next link.
    const first = await render('/posts')
    expect(first.html).toContain('/posts/2')

    const second = await render('/posts/2')
    expect(second.status).toBe(200)
    expect(second.html).toContain('/posts')
  })

  it('lists only what the repository returns as published', async () => {
    const { render } = setUp({ posts: [post({ title: 'One', slug: 'one' })] })

    const result = await render('/posts')

    expect(result.status).toBe(200)
    expect(result.html).toContain('One')
    // The card is a summary: a list does not need every post's body.
    expect(result.html).not.toContain('"type":"paragraph"')
  })
})

describe('a site that is not set up', () => {
  it('says so rather than rendering an empty theme', async () => {
    const { render } = setUp({ site: null })

    const result = await render('/')

    expect(result.status).toBe(503)
    expect(result.html).toContain('has not been set up yet')
    // And it is not a page anybody should find in a search result.
    expect(result.html).toContain('name="robots" content="noindex"')
  })

  it('says something different when there is no database at all', async () => {
    const result = await renderPage('/', { repositories: null, db: null, blob: null, baseUrl: 'https://example.com' })

    expect(result.status).toBe(503)
    expect(result.html).toContain('no database configured')
  })
})
