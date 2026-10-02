import { describe, expect, it } from 'vitest'
import { structuredData } from './seo'

/**
 * Structured data.
 *
 * The slice's acceptance says the output should pass Google's Rich Results test.
 * That tool is a website, and this environment cannot reach it, so the substitute
 * is a set of assertions against the properties Google documents as required for
 * each type. It is not the same thing as running the validator, and the
 * difference is worth being plain about:
 *
 *   - an assertion here proves a property is present
 *   - the validator also checks values (a date is a date, an image resolves) and
 *     decides whether the type qualifies for a rich result at all
 *
 * What these tests can do is the part the code controls: emit the required
 * properties when the data exists, and never claim one that does not.
 */

const base = {
  url: 'https://example.com/posts/hello',
  title: 'Hello',
  siteName: 'Example',
}

describe('a post', () => {
  it('carries the properties an article rich result requires', () => {
    const data = structuredData({
      ...base,
      kind: 'post',
      description: 'A description',
      image: 'https://example.com/media/1',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-02-02T00:00:00.000Z'),
      logoUrl: 'https://example.com/media/logo',
    })

    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      // Required by Google: headline, image, datePublished, author.
      headline: 'Hello',
      image: ['https://example.com/media/1'],
      datePublished: '2026-01-01T00:00:00.000Z',
      author: { '@type': 'Organization', name: 'Example' },
      // Recommended, and emitted because the data is there.
      dateModified: '2026-02-02T00:00:00.000Z',
      description: 'A description',
      mainEntityOfPage: { '@type': 'WebPage', '@id': 'https://example.com/posts/hello' },
      publisher: {
        '@type': 'Organization',
        name: 'Example',
        logo: { '@type': 'ImageObject', url: 'https://example.com/media/logo' },
      },
    })
  })

  it('omits an image it does not have rather than inventing one', () => {
    const data = structuredData({
      ...base,
      kind: 'post',
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    // Without an image the post will not qualify for an article rich result.
    // That is the honest outcome: a claim with no data behind it is worse than a
    // missing one, and a validator reads whatever is written.
    expect(data).not.toHaveProperty('image')
    expect(data).toHaveProperty('datePublished')
    // The publisher is the site and is known without a logo; only the logo is
    // conditional on there being one.
    expect(data).toMatchObject({ publisher: { '@type': 'Organization', name: 'Example' } })
    expect((data as { publisher: object }).publisher).not.toHaveProperty('logo')
  })
})

describe('a product', () => {
  it('is a Product and does not pretend to have an offer', () => {
    const data = structuredData({
      ...base,
      kind: 'product',
      url: 'https://example.com/products/widget',
      title: 'Widget',
      description: 'A widget',
    })

    expect(data).toMatchObject({
      '@type': 'Product',
      name: 'Widget',
      url: 'https://example.com/products/widget',
      description: 'A widget',
    })

    // There is no checkout and no price, so there is no `offers` to state. The
    // markup is valid schema.org and will not earn a product rich result, which
    // is what a showcase page honestly is.
    expect(data).not.toHaveProperty('offers')
  })
})

describe('everything else', () => {
  it('makes a list a collection and a page a page', () => {
    expect(structuredData({ ...base, kind: 'posts', url: 'https://example.com/posts' })).toMatchObject(
      { '@type': 'CollectionPage' },
    )
    expect(structuredData({ ...base, kind: 'products', url: 'https://example.com/products' })).toMatchObject(
      { '@type': 'CollectionPage' },
    )
    expect(structuredData({ ...base, kind: 'page', url: 'https://example.com/about' })).toMatchObject({
      '@type': 'WebPage',
    })
  })

  it('names the site the page belongs to, by origin and not by path', () => {
    const data = structuredData({ ...base, kind: 'page', url: 'https://example.com/about' })

    expect(data).toMatchObject({
      '@type': 'WebPage',
      url: 'https://example.com/about',
      isPartOf: { '@type': 'WebSite', name: 'Example', url: 'https://example.com' },
      // The slug must not leak into the origin it names.
    })
    expect(JSON.stringify(data)).not.toContain('example.com/about/about')
  })

  it('does not invent an origin it was not given', () => {
    // A preview has no base URL, so the context passes a relative path. The
    // render path must not throw on that, and must not claim an `isPartOf` URL
    // it cannot determine.
    const data = structuredData({ ...base, kind: 'page', url: '/sample-page' })

    expect(data).toMatchObject({ '@type': 'WebPage', url: '/sample-page' })
    expect((data as { isPartOf: object }).isPartOf).toEqual({
      '@type': 'WebSite',
      name: 'Example',
    })
  })

  it('says nothing about a page that does not exist', () => {
    // A 404 has nothing to describe, and telling a crawler it exists is worse
    // than silence.
    expect(structuredData({ ...base, kind: 'notFound', url: 'https://example.com/nope' })).toBeUndefined()
  })
})
