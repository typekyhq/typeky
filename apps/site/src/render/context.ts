import { attributionFor, DEFAULT_DATE_FORMAT, DEFAULT_LANGUAGE } from '@typeky/core'
import { structuredData } from './seo'
import type { Block, PageKind, Pagination, RenderContext } from '@typeky/core'

/**
 * Turning stored rows into what a template is given.
 *
 * One function, used by the preview and by the site's own rendering. That is the
 * point of it existing separately: the preview is only honest if it runs the
 * *same* assembly as the real page -- otherwise "what you see is what you get"
 * is a claim about two code paths agreeing, which is not a claim anybody can
 * keep.
 *
 * Everything a template cannot do itself happens here: sorting, counting,
 * resolving a media id to a URL, and turning blocks into HTML. A template that
 * had to do any of that would need the database, and the whole contract is that
 * it never reaches one.
 */

export interface SiteInput {
  name: string
  tagline: string | null
  logoMediaId: string | null
  settings: Record<string, unknown>
  nav: { label: string; href: string; order: number }[]
  /**
   * Whether a licence removes the attribution.
   *
   * A property of the deployment rather than of the site row, which is why it
   * arrives here rather than in the settings: buying a white-label licence is not
   * a content change, and it must not need a database write to take effect.
   */
  whiteLabel?: boolean
}

export interface ItemInput {
  kind: PageKind
  title: string
  slug: string
  blocks: Block[]
  seo: Record<string, unknown>
  /**
   * The items of a list page, when the kind is one.
   *
   * Present means `content` is this array rather than the item itself: a list
   * template iterates, and giving it an object with the items filed underneath
   * a key would be the platform inventing a shape instead of stating one.
   */
  listItems?: Record<string, unknown>[]
  excerpt?: string | null
  category?: string | null
  tags?: string[]
  /** A media id; resolved to `cover_url` for the template. */
  coverMediaId?: string | null
  priceLabel?: string | null
  gallery?: string[]
  specs?: { label: string; value: string }[]
  ctaLabel?: string | null
  ctaUrl?: string | null
  publishedAt?: Date | null
  /** Used for `dateModified` in structured data. */
  updatedAt?: Date | null
  /** Extra fields a template reads, already resolved. */
  extra?: Record<string, unknown>
}

export interface BuildContextInput {
  site: SiteInput
  item: ItemInput
  /** Absolute origin, when the deployment knows one. */
  baseUrl?: string
  /**
   * The list's paging state.
   *
   * On `page`, not on `content`: paging is a property of the page that was asked
   * for, and a template reading it from the content would work for one shape of
   * list and quietly not for another.
   */
  pagination?: Pagination
  /** Whether the theme's own default SEO should stand in for a missing one. */
  defaults?: { title?: string; description?: string }
  /** Resolve a media id to a URL, or return null when there is no such media. */
  resolveMedia?: (id: string) => string | null
  /** Marked on the context so a template can tell it is not the real page. */
  preview?: boolean
}

/** Absolute origin plus a path, or the path alone when there is no origin. */
function absolute(baseUrl: string | undefined, path: string): string {
  const base = (baseUrl ?? '').replace(/\/+$/, '')
  if (base === '') return path
  return `${base}${path.startsWith('/') ? '' : '/'}${path}`
}

/**
 * A URL for a piece of content.
 *
 * The shape of the site's URLs lives here rather than in a template: a theme
 * that builds its own links breaks the day the platform changes one, and there
 * is no way to tell a template author that their links are wrong.
 */
export function contentPath(kind: PageKind, slug: string): string {
  switch (kind) {
    case 'post':
      return `/posts/${slug}`
    case 'posts':
      return '/posts'
    case 'product':
      return `/products/${slug}`
    case 'products':
      return '/products'
    case 'home':
      return '/'
    case 'notFound':
      return '/404'
    default:
      return `/${slug}`
  }
}

export function buildRenderContext(input: BuildContextInput): RenderContext {
  const { site, item, baseUrl, defaults, resolveMedia } = input

  const url = contentPath(item.kind, item.slug)
  const resolve = (id: string | null | undefined): string | undefined => {
    if (id === null || id === undefined || resolveMedia === undefined) return undefined
    return resolveMedia(id) ?? undefined
  }

  // A description the author wrote wins, then the excerpt, then the site's
  // default. This order is the platform's opinion, and it belongs in one place
  // rather than being re-derived by every theme.
  const description =
    (typeof item.seo.description === 'string' ? item.seo.description : undefined) ??
    item.excerpt ??
    defaults?.description ??
    undefined

  const title =
    (typeof item.seo.title === 'string' ? item.seo.title : undefined) ?? item.title ?? defaults?.title ?? ''

  const ogImage = resolve(typeof item.seo.ogImageMediaId === 'string' ? item.seo.ogImageMediaId : undefined)
  const canonical =
    typeof item.seo.canonical === 'string' ? item.seo.canonical : absolute(baseUrl, url)

  // Structured data, built here so a template only prints it.
  const jsonLd = structuredData({
    kind: item.kind,
    url: canonical ?? absolute(baseUrl, url),
    title,
    ...(description === undefined ? {} : { description }),
    ...(ogImage === undefined ? {} : { image: ogImage }),
    siteName: site.name,
    ...(resolve(site.logoMediaId) === undefined ? {} : { logoUrl: resolve(site.logoMediaId) }),
    ...(item.publishedAt === null || item.publishedAt === undefined ? {} : { publishedAt: item.publishedAt }),
    ...(item.updatedAt === null || item.updatedAt === undefined ? {} : { updatedAt: item.updatedAt }),
  })

  const socialLinks = Array.isArray(site.settings.socialLinks)
    ? (site.settings.socialLinks as { label: string; href: string }[])
    : undefined

  return {
    site: {
      name: site.name,
      ...(site.tagline === null ? {} : { tagline: site.tagline }),
      ...(resolve(site.logoMediaId) === undefined ? {} : { logo_url: resolve(site.logoMediaId) }),
      language: typeof site.settings.language === 'string' ? site.settings.language : DEFAULT_LANGUAGE,
      date_format:
        typeof site.settings.dateFormat === 'string' ? site.settings.dateFormat : DEFAULT_DATE_FORMAT,
      nav: [...site.nav]
        .sort((left, right) => left.order - right.order)
        .map((entry) => ({ label: entry.label, href: entry.href })),
      settings: {
        ...(typeof site.settings.footer === 'string' ? { footer: site.settings.footer } : {}),
        ...(socialLinks === undefined ? {} : { social_links: socialLinks }),
        ...(typeof site.settings.filingNumber === 'string' ? { filing_number: site.settings.filingNumber } : {}),
        ...(typeof site.settings.cookieNotice === 'string' ? { cookie_notice: site.settings.cookieNotice } : {}),
      },
      // Absent, not empty, when a licence removes it -- so a template's `{% if %}`
      // is the whole check and there is no half-rendered badge to get wrong.
      ...(() => {
        const attribution = attributionFor({ whiteLabel: site.whiteLabel === true })

        return attribution === undefined ? {} : { attribution }
      })(),
    },

    page: {
      kind: item.kind,
      url,
      canonical,
      ...(item.kind === 'page' || item.kind === 'home' || item.kind === 'notFound' ? {} : { title: item.title }),
      ...(input.pagination === undefined ? {} : { pagination: input.pagination }),
    },

    content: item.listItems ?? contentFor(item, resolve),

    seo: {
      title,
      ...(description === undefined ? {} : { description }),
      ...(ogImage === undefined ? {} : { og_image: ogImage }),
      ...(jsonLd === undefined ? {} : { json_ld: jsonLd }),
    },

    ...(input.preview === true ? { preview: true } : {}),
  }
}

/**
 * The item as a template sees it.
 *
 * Field names are snake_case here and camelCase in storage. That conversion is a
 * job, not an accident: Liquid has no notion of a camel case, every existing
 * Shopify theme writes `price_label`, and a theme author should not have to
 * learn which platform field is spelled differently.
 */
function contentFor(
  item: ItemInput,
  resolve: (id: string | null | undefined) => string | undefined,
): Record<string, unknown> {
  const cover = resolve(item.coverMediaId)

  return {
    title: item.title,
    slug: item.slug,
    url: contentPath(item.kind, item.slug),
    blocks: item.blocks,
    ...(cover === undefined ? {} : { cover_url: cover }),
    ...(item.excerpt === null || item.excerpt === undefined ? {} : { excerpt: item.excerpt }),
    ...(item.category === null || item.category === undefined ? {} : { category: item.category }),
    ...(item.tags === undefined ? {} : { tags: item.tags }),
    ...(item.priceLabel === null || item.priceLabel === undefined ? {} : { price_label: item.priceLabel }),
    ...(item.gallery === undefined ? {} : { gallery: item.gallery.map((id) => resolve(id) ?? id) }),
    ...(item.specs === undefined ? {} : { specs: item.specs }),
    ...(item.ctaLabel === null || item.ctaLabel === undefined ? {} : { cta_label: item.ctaLabel }),
    ...(item.ctaUrl === null || item.ctaUrl === undefined ? {} : { cta_url: item.ctaUrl }),
    ...(item.publishedAt === null || item.publishedAt === undefined
      ? {}
      : { published_at: item.publishedAt.toISOString() }),
    ...item.extra,
  }
}
