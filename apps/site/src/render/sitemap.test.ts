import type { Page, Post, Product, Repositories } from '@typeky/db'
import { describe, expect, it } from 'vitest'
import { renderRobots, renderSitemap } from './sitemap'

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

  const result = (items: unknown[]) => ({ items, total: items.length, limit: 100, offset: 0 })

  return {
    pages: {
      async home() { return pages.find((entry) => entry.isHome) ?? null },
      async list() { return result(pages) },
    },
    posts: { async list() { return result(posts) } },
    products: { async list() { return result(products) } },
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
