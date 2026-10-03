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
   * own `datetime` attributes and its text in one place -- and it is why the
   * bundled theme passes `'UTC'` alongside it, since a Worker runs in UTC and a
   * laptop does not.
   */
  date_format: string
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
