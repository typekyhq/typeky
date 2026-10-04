import {
  attributionFor,
  decodeCharacterReferences,
  DEFAULT_DATE_FORMAT,
  DEFAULT_LANGUAGE,
  DEFAULT_TIME_ZONE,
  isTimeZone,
} from '@typeky/core'
import { structuredData } from './seo'
import { seoImageId, seoTitleTemplate } from './seo-settings'
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
  faviconMediaId: string | null
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

/** A term as a template sees it: the thing a page prints, not the whole row. */
export interface TemplateTerm {
  name: string
  slug: string
  /**
   * The vocabulary it belongs to.
   *
   * There on purpose: a site may keep more than one, and "Frontend" printed
   * without saying whether it is a category or a topic is a label a reader cannot
   * place. Ancestors are deliberately not here -- a breadcrumb belongs to the
   * archive route, which does not exist yet.
   */
  vocabulary: string
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
  /**
   * The terms this content carries, already shaped for a template.
   *
   * Absent when there are none rather than an empty array: Liquid treats an empty
   * array as truthy, so `{% if content.terms %}` would be true for a post with no
   * terms if this were `[]`.
   */
  terms?: TemplateTerm[]
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

/** A named zone this runtime can render, or UTC when the row does not hold one. */
function usableTimeZone(value: unknown): string {
  return typeof value === 'string' && isTimeZone(value) ? value : DEFAULT_TIME_ZONE
}

/** The page title as a browser tab and a search result show it. */
function documentTitle(rawTitle: string, template: string | undefined, siteName: string): string {
  // A page that has nothing to call itself still needs a name in the tab, and the
  // site's own is the only true thing to put there. It is also what keeps a
  // template like `%s · Example` from rendering as a bare " · Example".
  if (rawTitle === '') return siteName

  // `%s` is the whole directive language, and a template without one was refused
  // when it was saved -- so the replace is the last thing that could go wrong here.
  return (template ?? '%s').replaceAll('%s', rawTitle)
}

/**
 * The operator's custom settings as one object, or nothing.
 *
 * A list on the way in because that is what an operator edits, an object on the way
 * out because that is what a template reads. Absent when there are none, so
 * `{% if site.settings.custom %}` is about whether the site has any rather than
 * about whether Liquid treats an empty object as truthy.
 */
function customSettings(value: unknown): Record<string, string> | undefined {
  if (!Array.isArray(value)) return undefined

  const entries = value.filter(
    (entry): entry is { key: string; value: string } =>
      typeof entry === 'object' &&
      entry !== null &&
      typeof (entry as Record<string, unknown>).key === 'string' &&
      typeof (entry as Record<string, unknown>).value === 'string',
  )

  if (entries.length === 0) return undefined

  return Object.fromEntries(
    entries.map((entry) => [entry.key, decodeCharacterReferences(entry.value)]),
  )
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

  // The page's own share image, and then the site's: a page that has not thought
  // about how it looks when it is linked still had somebody set a default, and a
  // card with an image is one people click.
  const ogImage =
    resolve(typeof item.seo.ogImageMediaId === 'string' ? item.seo.ogImageMediaId : undefined) ??
    resolve(seoImageId(site.settings))
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
    ? (site.settings.socialLinks as { label: string; href: string }[]).map((link) => ({
        label: decodeCharacterReferences(link.label),
        href: link.href,
      }))
    : undefined

  const custom = customSettings(site.settings.custom)

  return {
    site: {
      name: site.name,
      // Operator-written copy, so character references are resolved: a theme escapes
      // everything it prints, and `&copy;` typed into a setting has to reach a reader
      // as the character. See `decodeCharacterReferences`.
      ...(site.tagline === null ? {} : { tagline: decodeCharacterReferences(site.tagline) }),
      ...(resolve(site.logoMediaId) === undefined ? {} : { logo_url: resolve(site.logoMediaId) }),
      ...(resolve(site.faviconMediaId) === undefined
        ? {}
        : { favicon_url: resolve(site.faviconMediaId) }),
      language: typeof site.settings.language === 'string' ? site.settings.language : DEFAULT_LANGUAGE,
      date_format:
        typeof site.settings.dateFormat === 'string' ? site.settings.dateFormat : DEFAULT_DATE_FORMAT,
      // A zone the runtime cannot render would throw on every page that prints a
      // date, and Liquid's `date` filter throws rather than falling back. The
      // setting is validated when it is saved, so this is the floor under a row
      // somebody edited by hand: an unusable zone renders in UTC rather than
      // taking the site down.
      timezone: usableTimeZone(site.settings.timezone),
      nav: [...site.nav]
        .sort((left, right) => left.order - right.order)
        .map((entry) => ({ label: decodeCharacterReferences(entry.label), href: entry.href })),
      settings: {
        ...(typeof site.settings.footer === 'string'
          ? { footer: decodeCharacterReferences(site.settings.footer) }
          : {}),
        ...(socialLinks === undefined ? {} : { social_links: socialLinks }),
        ...(typeof site.settings.cookieNotice === 'string' ? { cookie_notice: site.settings.cookieNotice } : {}),
        ...(custom === undefined ? {} : { custom }),
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
      document_title: documentTitle(title, seoTitleTemplate(site.settings), site.name),
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
    ...(item.terms === undefined || item.terms.length === 0 ? {} : { terms: item.terms }),
    ...(item.tags === undefined ? {} : { tags: item.tags }),
    ...(item.priceLabel === null || item.priceLabel === undefined ? {} : { price_label: item.priceLabel }),
    ...(item.gallery === undefined ? {} : { gallery: item.gallery.map((id) => resolve(id) ?? id) }),
    ...(item.specs === undefined ? {} : { specs: item.specs }),
    ...(item.ctaLabel === null || item.ctaLabel === undefined ? {} : { cta_label: item.ctaLabel }),
    ...(item.ctaUrl === null || item.ctaUrl === undefined ? {} : { cta_url: item.ctaUrl }),
    ...(item.publishedAt === null || item.publishedAt === undefined
      ? {}
      : { published_at: item.publishedAt.toISOString() }),
    ...(item.updatedAt === null || item.updatedAt === undefined
      ? {}
      : { updated_at: item.updatedAt.toISOString() }),
    ...item.extra,
  }
}
