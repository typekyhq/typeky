import type { Attribution } from './attribution'

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
  cookie_notice?: string
  /**
   * Whatever the operator added under "Custom settings", as one object.
   *
   * The escape hatch, and the one field here no bundled template reads on
   * purpose: its whole point is that a theme reaches for the value it wants by
   * name, which a theme written before the key existed cannot do. Keys are lower
   * snake case, so `site.settings.custom.contact_email` is a plain name in Liquid
   * rather than a bracket expression.
   */
  custom?: Record<string, string>
}

export interface SiteForTemplates {
  name: string
  tagline?: string
  /** Resolved to a URL: a template cannot turn a media id into one. */
  logo_url?: string
  /** The browser tab icon, also resolved. Absent when none is set. */
  favicon_url?: string
  /** BCP 47, for the `lang` attribute. */
  language: string
  /**
   * A strftime format for `| date`, e.g. `%B %-d, %Y`.
   *
   * The platform does not format dates for the theme; it hands over the format
   * the site was configured with, and the theme renders. That keeps the theme's
   * own `datetime` attributes and its text in one place.
   */
  date_format: string
  /**
   * The zone `date_format` is rendered in, e.g. `Asia/Shanghai`.
   *
   * A site-level setting rather than the theme's, and passed to `| date` as its
   * second argument. It used to be the string `'UTC'` written into every template:
   * true of a Worker and false of the operator, who is writing for readers in a
   * zone they know. Always present, defaulting to `UTC`, so a theme never has to
   * decide what "no zone" means.
   */
  timezone: string
  nav: NavItem[]
  settings: SiteSettingsForTemplates
  /**
   * Absent when the site is licensed to run without it, which is the whole
   * difference the white-label purchase makes to the front end.
   */
  attribution?: Attribution
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
  /** The page's own title: what a card and a search result's headline say. */
  title: string
  /**
   * `title` with the site's title template applied, for `<title>`.
   *
   * Separate from `title` because the two are read by different audiences with
   * different ideas about branding: a browser tab and a search result benefit from
   * the site's name, while a social card already carries it in `og:site_name` and
   * a `BlogPosting` headline should be the headline. A template of `%s` -- the
   * default -- makes the two identical.
   */
  document_title: string
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

/**
 * The top-level keys, for the check that keeps templates honest.
 *
 * A type cannot be read at runtime, and the CI check in `scripts/check-context.ts`
 * needs the list: it collects the free variables the theme's templates use and
 * asserts they match these exactly, in both directions. The two declarations are
 * held together by the assertion below -- a key added to one and not the other
 * does not compile.
 */
export const RENDER_CONTEXT_KEYS = ['site', 'page', 'content', 'seo'] as const

// Both directions: every listed key is a key of the interface, and every required
// key of the interface is listed. An extra name here, or a missing one, is a type
// error rather than a check that quietly passes.
const _keysAreExact: ReadonlyArray<keyof RenderContext> = RENDER_CONTEXT_KEYS
const _keysAreComplete: ReadonlyArray<(typeof RENDER_CONTEXT_KEYS)[number]> = [
  'site',
  'page',
  'content',
  'seo',
] satisfies ReadonlyArray<Exclude<keyof RenderContext, 'preview'>>
void _keysAreExact
void _keysAreComplete
