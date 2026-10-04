import type { PageKind } from '@typeky/core'

/**
 * Structured data.
 *
 * Built here rather than in a template, because the rule the architecture sets is
 * that complexity happens in TypeScript and a theme displays. A template
 * assembling JSON-LD would need the site's origin, the dates and the media URLs,
 * which is three things it does not have and should not.
 *
 * The types are chosen to match what the page *is*, since a search engine reads
 * the type before it reads anything else:
 *
 *   - a post is a `BlogPosting`
 *   - a product is a `Product`
 *   - a list is a `CollectionPage`
 *   - anything else with content on it is a `WebPage`
 *   - a 404 says nothing at all: a page that does not exist has nothing to
 *     describe, and telling a crawler it exists is worse than silence.
 *
 * Each type carries the properties its rich result requires, and only when the
 * data is actually there. A `BlogPosting` without an image is honest and will
 * not qualify; a `BlogPosting` claiming an image it does not have is a lie a
 * validator will happily read.
 */

export interface StructuredDataInput {
  kind: PageKind
  /** Absolute, so a crawler can resolve it. */
  url: string
  title: string
  description?: string
  image?: string
  siteName: string
  /** Absolute, for `publisher.logo`. */
  logoUrl?: string
  publishedAt?: Date
  updatedAt?: Date
}

export function structuredData(input: StructuredDataInput): Record<string, unknown> | undefined {
  if (input.kind === 'notFound') return undefined

  const description = input.description === undefined ? {} : { description: input.description }
  const image = input.image === undefined ? {} : { image: [input.image] }

  if (input.kind === 'post') {
    return {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: input.title,
      ...description,
      ...image,
      ...(input.publishedAt === undefined ? {} : { datePublished: input.publishedAt.toISOString() }),
      ...(input.updatedAt === undefined ? {} : { dateModified: input.updatedAt.toISOString() }),
      // A single-author site: the site is the author, and saying so is truer
      // than inventing a person.
      author: { '@type': 'Organization', name: input.siteName },
      publisher: {
        '@type': 'Organization',
        name: input.siteName,
        ...(input.logoUrl === undefined ? {} : { logo: { '@type': 'ImageObject', url: input.logoUrl } }),
      },
      mainEntityOfPage: { '@type': 'WebPage', '@id': input.url },
    }
  }

  if (input.kind === 'product') {
    // No `offers`: there is no checkout, so there is no price amount or
    // availability to state. This is a valid `Product` and will not earn a
    // product rich result, which is the honest outcome for a showcase page.
    return {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: input.title,
      ...description,
      ...image,
      url: input.url,
    }
  }

  // Everything else is a page of the site, and a list is a collection of it.
  return {
    '@context': 'https://schema.org',
    '@type':
      input.kind === 'posts' || input.kind === 'products' || input.kind === 'term'
        ? 'CollectionPage'
        : 'WebPage',
    name: input.title,
    url: input.url,
    ...description,
    ...image,
    isPartOf: { '@type': 'WebSite', name: input.siteName, ...originOf(input.url) },
  }
}

/**
 * The origin of an absolute URL, as an object to spread in, or nothing.
 *
 * A preview has no base URL -- the site does not exist yet, so the context does
 * not invent one -- and `new URL('/posts/x')` throws. A render path must not
 * throw on data it was handed, so an origin it cannot determine is simply not
 * claimed.
 */
function originOf(url: string): { url: string } | Record<string, never> {
  try {
    return { url: new URL(url).origin }
  } catch {
    return {}
  }
}
