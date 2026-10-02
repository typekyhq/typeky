import type { Page, Post, Product, Repositories } from '@typeky/db'
import { describe, expect, it } from 'vitest'
import { publishedPaths, renderRobots, renderSitemap } from './sitemap'

/**
 * `sitemap.xml` and `robots.txt`.
 *
 * Generated rather than stored, because both are statements about what the site
 * contains right now. What matters here is that only published things appear and
 * that a title cannot break the document it is written into.
 */

function store(options: { pages?: Page[]; posts?: Post[]; products?: Product[] } = {}): Repositories {
  const pages = options.pages ?? []
  const posts = options.posts ?? []
  const products = options.products ?? []

  // A window over the whole set, so the paging loop in the sitemap is exercised
  // rather than bypassed by an answer that happens to fit.
  const paged =
    <T>(items: T[]) =>
    async (_ctx: unknown, query: { limit?: number; offset?: number } = {}) => {
      const limit = query.limit ?? 20
      const offset = query.offset ?? 0

      return { items: items.slice(offset, offset + limit), total: items.length, limit, offset }
    }

  return {
    pages: {
      async home() { return pages.find((entry) => entry.isHome) ?? null },
      list: paged(pages),
    },
    posts: { list: paged(posts) },
    products: { list: paged(products) },
  } as unknown as Repositories
}

const stamp = new Date('2026-03-03T00:00:00.000Z')

function page(overrides: Partial<Page> & { slug: string }): Page {
  return { title: overrides.slug, blocks: [], seo: {}, status: 'published', isHome: false, updatedAt: stamp, ...overrides } as Page
}
function post(overrides: Partial<Post> & { slug: string }): Post {
  return { title: overrides.slug, blocks: [], tags: [], seo: {}, status: 'published', updatedAt: stamp, ...overrides } as Post
}

describe('the sitemap', () => {
  it('lists published content, the lists, and the front page once', async () => {
    const xml = await renderSitemap(
      store({
        pages: [page({ slug: 'home', isHome: true }), page({ slug: 'about' })],
        posts: [post({ slug: 'hello' })],
      }),
      'https://example.com',
    )

    expect(xml).toContain('<loc>https://example.com/</loc>')
    expect(xml).toContain('<loc>https://example.com/posts</loc>')
    expect(xml).toContain('<loc>https://example.com/posts/hello</loc>')
    expect(xml).toContain('<loc>https://example.com/products</loc>')
    expect(xml).toContain('<loc>https://example.com/about</loc>')

    // The home page is `/`, not `/home`: its slug is not a URL it has.
    expect(xml).not.toContain('/home')
    expect(xml.match(/<loc>https:\/\/example\.com\/<\/loc>/g)).toHaveLength(1)
  })

  it('leaves drafts out, even if one comes back from the query', async () => {
    const xml = await renderSitemap(
      store({
        pages: [page({ slug: 'secret', status: 'draft' })],
        posts: [post({ slug: 'unfinished', status: 'draft' })],
      }),
      'https://example.com',
    )

    // The repository is asked for published rows and the sitemap checks again: a
    // sitemap that listed a draft would be asking to have it indexed, and that is
    // not a mistake worth leaving to a filter one layer down.
    expect(xml).not.toContain('/secret')
    expect(xml).not.toContain('/unfinished')
    expect(xml).toContain('<loc>https://example.com/</loc>')
  })

  it('cannot be broken by a title, because it writes paths and dates only', async () => {
    const xml = await renderSitemap(
      store({ posts: [post({ slug: 'a&b' })] }),
      'https://example.com',
    )

    expect(xml).toContain('a&amp;b')
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
  })

  it('lists the pages of a list, because each one is a page a visitor can land on', async () => {
    // 25 posts at ten to a page is three list pages. They are also the URLs that
    // move the moment anything is published, which is why the purge set needs
    // them as much as the sitemap does.
    const posts = Array.from({ length: 25 }, (_, index) => post({ slug: `p${String(index)}` }))
    const xml = await renderSitemap(store({ posts }), 'https://example.com')

    expect(xml).toContain('<loc>https://example.com/posts</loc>')
    expect(xml).toContain('<loc>https://example.com/posts/2</loc>')
    expect(xml).toContain('<loc>https://example.com/posts/3</loc>')
    expect(xml).not.toContain('<loc>https://example.com/posts/4</loc>')
  })
})

describe('the paths a publish invalidates', () => {
  it('are the same set the sitemap lists', async () => {
    const store_ = store({
      pages: [page({ slug: 'home', isHome: true }), page({ slug: 'about' })],
      posts: Array.from({ length: 25 }, (_, index) => post({ slug: `p${String(index)}` })),
    })

    const paths = await publishedPaths(store_)
    const xml = await renderSitemap(store_, 'https://example.com')

    // One question, one implementation: a sitemap and a purge set that disagreed
    // would either leave a stale page or crawl one that is not there.
    for (const path of paths) {
      expect(xml).toContain(`<loc>https://example.com${path === '/' ? '/' : path}</loc>`)
    }
    expect(paths).toContain('/posts/3')
  })
})

describe('robots.txt', () => {
  it('points at the sitemap and keeps crawlers out of the admin', async () => {
    const text = renderRobots('https://example.com/')

    expect(text).toContain('User-agent: *')
    expect(text).toContain('Sitemap: https://example.com/sitemap.xml')
    expect(text).toContain('Disallow: /admin')
    expect(text).toContain('Disallow: /api/')
  })
})
