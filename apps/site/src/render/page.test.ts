import type { DbPort } from '@typeky/platform'
import type { Page, Post, Product, Repositories, Site, Term } from '@typeky/db'
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
    seo: {},
    status: 'published',
    revision: 1,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Post
}

function setUp(
  options: {
    pages?: Page[]
    posts?: Post[]
    products?: Product[]
    site?: Site | null
    /** Stored template overrides, as the loader would read them. */
    overrides?: { path: string; source: string }[]
    /** Terms by content id, as `terms.forContent` would answer them. */
    terms?: Record<string, Term[]>
    whiteLabel?: boolean
  } = {},
) {
  const pages = options.pages ?? []
  const posts = options.posts ?? []
  const termsById = options.terms
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
    // The taxonomy: a page prints the terms its content carries, and asks for the
    // vocabulary names only when it has any to print.
    vocabularies: {
      async list() {
        return [{ id: 'vocab_1', name: 'Categories' }]
      },
    },
    terms: {
      async forContent(_ctx: unknown, _type: unknown, id: string) {
        return (termsById ?? {})[id] ?? []
      },
      async forContentMany(_ctx: unknown, _type: unknown, ids: string[]) {
        return new Map(ids.map((id) => [id, (termsById ?? {})[id] ?? []]))
      },
    },
  } as unknown as Repositories

  const db: DbPort = {
    async all<T>() { return (options.overrides ?? []) as T[] },
    async first<T>() { return null as T | null },
    async run() { return 0 },
    async batch() { return undefined },
  }

  return { render: (path: string) =>
      renderPage(path, { repositories: store, db, blob: null, baseUrl: 'https://example.com', whiteLabel: options.whiteLabel ?? false }) }
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

  it('prints the terms a post is filed under', async () => {
    const { render } = setUp({
      posts: [post({ title: 'Filed', slug: 'filed' })],
      terms: {
        filed: [
          {
            id: 'term_1',
            vocabularyId: 'vocab_1',
            parentId: null,
            name: 'News',
            slug: 'news',
            description: null,
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      },
    })

    const result = await render('/posts/filed')

    expect(result.status).toBe(200)
    expect(result.html).toContain('<span class="term">News</span>')
  })

  it('omits the field entirely when a post carries no terms', async () => {
    const { render } = setUp({ posts: [post({ title: 'Bare', slug: 'bare' })] })

    // Absent rather than an empty array: Liquid treats an empty array as truthy,
    // so `{% if content.terms %}` would be true for a post with none.
    expect((await render('/posts/bare')).html).not.toContain('class="term"')
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

describe('structured data in the page', () => {
  it('is JSON a validator can read, not escaped markup', async () => {
    const { render } = setUp({
      posts: [post({ title: 'Hello', slug: 'hello' })],
    })

    const result = await render('/posts/hello')
    const block = /<script type="application\/ld\+json">([^<]*)<\/script>/.exec(result.html)

    expect(block).not.toBeNull()

    // Rendering found this broken: the quotes came out as `&#34;` and nothing
    // could parse the block. The filter that fixed it is asserted on its own too.
    const json = block?.[1] ?? ''
    expect(json).not.toContain('&#34;')
    expect(JSON.parse(json)).toMatchObject({ '@type': 'BlogPosting', headline: 'Hello' })
  })

  it('says nothing on a page that does not exist', async () => {
    const { render } = setUp({})

    // A 404 has nothing to describe, and telling a crawler it exists is worse
    // than saying nothing.
    expect((await render('/nope')).html).not.toContain('application/ld+json')
  })
})

describe('the attribution', () => {
  const home = page({ title: 'Home', slug: 'home', isHome: true })

  it('is rendered by the theme, and only once', async () => {
    const { render } = setUp({ pages: [home] })

    const html = (await render('/')).html

    // The theme's footer has it. The platform must recognise that and not add a
    // second one.
    expect(html.match(/data-typeky-attribution/g)).toHaveLength(1)
    expect(html).toContain('Powered by Typeky')
    expect(html).toContain('https://typeky.com')
    expect(html).toContain('rel="noopener"')
    // A backlink the page tells crawlers to ignore would be a badge pretending to
    // be one.
    expect(html).not.toContain('nofollow')
  })

  it('is put back when the theme has removed it', async () => {
    // The floor. A deployment may edit its templates, and the footer is the first
    // thing anybody edits, so "the badge is rendered" cannot depend only on the
    // theme's cooperation.
    const { render } = setUp({
      pages: [home],
      overrides: [{ path: 'snippets/footer', source: '<footer class="site-footer">A footer with no badge.</footer>' }],
    })

    const html = (await render('/')).html

    expect(html).toContain('A footer with no badge.')
    expect(html).toContain('data-typeky-attribution')
  })

  it('is absent, and not merely empty, when a licence covers the domain', async () => {
    const { render } = setUp({ pages: [home], whiteLabel: true })

    const html = (await render('/')).html

    expect(html).not.toContain('data-typeky-attribution')
    expect(html).not.toContain('Powered by Typeky')
  })

  it('is absent on a 404 too, once it is licensed', async () => {
    // Every page of the site is covered, not only the ones with a footer.
    const { render } = setUp({ pages: [home], whiteLabel: true })

    const html = (await render('/nope')).html

    expect(html).not.toContain('data-typeky-attribution')
  })
})

describe('language and dates', () => {
  const home = page({ title: 'Home', slug: 'home', isHome: true })

  it('writes the configured language into the html element', async () => {
    const { render } = setUp({ pages: [home] })

    expect((await render('/')).html).toContain('<html lang="en">')
  })

  it('uses the configured language and date format, not the built-in defaults', async () => {
    // The site row is the only place these come from, and neither used to be
    // reachable: `language` was overwritten with 'en' on the way into the context,
    // and a date format was not a setting at all.
    const site = {
      ...SITE,
      settings: { ...SITE.settings, language: 'zh-CN', dateFormat: '%Y年%-m月%-d日' },
    } as unknown as Site

    const { render } = setUp({ pages: [home], posts: [post({ title: 'Hello', slug: 'hello' })], site })

    const list = (await render('/posts')).html

    expect(list).toContain('<html lang="zh-CN">')
    // 2026-01-01T00:00:00Z, in UTC, in the format the site was configured with.
    expect(list).toContain('2026年1月1日')
    expect(list).not.toContain('January 1, 2026')
  })

  it('renders in UTC rather than in the machine the Worker happens to run on', async () => {
    // A date near midnight is the case that shows it: the bundled theme asks for
    // UTC, so the same content renders the same date in development and in
    // production even when the two are in different zones.
    const { render } = setUp({
      posts: [post({ title: 'Late', slug: 'late', publishedAt: new Date('2026-01-01T23:30:00.000Z') })],
      pages: [home],
    })

    expect((await render('/posts')).html).toContain('January 1, 2026')
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
    const result = await renderPage('/', { repositories: null, db: null, blob: null, baseUrl: 'https://example.com', whiteLabel: false })

    expect(result.status).toBe(503)
    expect(result.html).toContain('no database configured')
  })
})
