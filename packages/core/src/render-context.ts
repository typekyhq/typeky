/**
 * What a theme template is given.
 *
 * The single source of truth, and zero-dependency on purpose: the site side
 * reads this type and must not pull in the data layer to do it. The architecture
 * sketch in section 3.4 lists `utils` and `i18n` as objects of functions; the
 * implemented surface is the filters that do the same work (`url`, `asset_url`,
 * `money`, `t`), because the context itself is required to be plain JSON -- a
 * function in it would not survive being handed to Liquid, and would not survive
 * being cached either.
 *
 * Every field here is consumed by at least one template in the default theme.
 * A field nothing reads is a promise the platform is not keeping.
 */

export type PageKind = 'home' | 'page' | 'post' | 'posts' | 'product' | 'products' | 'notFound'

export interface NavItem {
  label: string
  href: string
}

export interface SiteSettingsForTemplates {
  footer?: string
  social_links?: { label: string; href: string }[]
  filing_number?: string
  cookie_notice?: string
}

export interface SiteForTemplates {
  name: string
  tagline?: string
  /** Resolved to a URL: a template cannot turn a media id into one. */
  logo_url?: string
  /** BCP 47, for the `lang` attribute. */
  language: string
  nav: NavItem[]
  settings: SiteSettingsForTemplates
}

export interface Pagination {
  page: number
  pages: number
  previous_url?: string
  next_url?: string
}

export interface PageForTemplates {
  kind: PageKind
  url: string
  /** Absolute, when the site knows its own origin. */
  canonical?: string
  /** The heading a list page needs and a detail page takes from its content. */
  title?: string
  pagination?: Pagination
}

export interface SeoForTemplates {
  title: string
  description?: string
  /** Absolute: a relative Open Graph image is not one. */
  og_image?: string
  json_ld?: unknown
}

/**
 * `content` is the page's main data, already computed.
 *
 * An array on a list page and a single object on a detail page, which is why the
 * architecture requires the sorting, counting and media resolution to have
 * happened before this point: a template that has to do arithmetic is a template
 * that has to be trusted.
 */
export interface RenderContext {
  site: SiteForTemplates
  page: PageForTemplates
  content: Record<string, unknown> | Record<string, unknown>[]
  seo: SeoForTemplates
  /** The preview says so, so a template can avoid emitting a canonical URL. */
  preview?: boolean
}
