import type { Block } from '@typeky/core'

/**
 * Domain types for the six CE tables.
 *
 * These are what repositories return and accept. They are not the storage shape:
 * JSON columns arrive decoded and timestamps as `Date`, which is precisely the
 * conversion `@typeky/core/codec` exists to perform (architecture section 5.2).
 */

export type ContentStatus = 'draft' | 'published'

/**
 * Block JSON as stored in a `content_blocks` column.
 *
 * The shape is defined in `@typeky/core` rather than here, because the site side
 * renders it and must not depend on the data layer to read the type.
 */
export type BlockContent = Block[]

export interface SeoMetadata {
  title?: string
  description?: string
  /** Media id, resolved to a URL at render time. */
  ogImageMediaId?: string
  /** Overrides the canonical URL derived from the slug. */
  canonical?: string
}

export interface NavItem {
  label: string
  href: string
  order: number
}

export interface SocialLink {
  label: string
  href: string
}

export interface SiteSettings {
  accentColor?: string
  socialLinks?: SocialLink[]
  seo?: { defaultTitle?: string; defaultDescription?: string }
  footer?: string
  /** ICP filing number, shown in the footer for deployments in mainland China. */
  filingNumber?: string
}

export interface Site {
  id: string
  name: string
  tagline: string | null
  logoMediaId: string | null
  theme: string
  settings: SiteSettings
  nav: NavItem[]
  createdAt: Date
  updatedAt: Date
}

export interface MediaItem {
  id: string
  filename: string
  storageKey: string
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
  altText: string | null
  createdAt: Date
}

export interface Page {
  id: string
  title: string
  slug: string
  blocks: BlockContent
  seo: SeoMetadata
  status: ContentStatus
  isHome: boolean
  sortOrder: number
  revision: number
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface Post {
  id: string
  title: string
  slug: string
  excerpt: string | null
  coverMediaId: string | null
  blocks: BlockContent
  tags: string[]
  category: string | null
  seo: SeoMetadata
  status: ContentStatus
  revision: number
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ProductSpec {
  label: string
  value: string
}

export interface Product {
  id: string
  title: string
  slug: string
  summary: string | null
  blocks: BlockContent
  coverMediaId: string | null
  gallery: string[]
  specs: ProductSpec[]
  priceLabel: string | null
  ctaLabel: string | null
  ctaUrl: string | null
  seo: SeoMetadata
  status: ContentStatus
  sortOrder: number
  revision: number
  publishedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ThemeTemplate {
  id: string
  theme: string
  /** For example `templates/post`, `snippets/header` or `layouts/base`. */
  path: string
  source: string
  revision: number
  updatedAt: Date
}

/* ---------------------------------------------------------------- writes -- */

/*
 * Writes are whole documents, not patches. Everything you leave out is stored as
 * its empty value. A patch-shaped API would make "field omitted" and "field
 * cleared" indistinguishable, which is exactly the ambiguity that turns into
 * silently wiped settings.
 */

export interface SiteWrite {
  name: string
  tagline: string | null
  logoMediaId: string | null
  theme: string
  settings: SiteSettings
  nav: NavItem[]
}

export interface MediaWrite {
  /** Omitted when creating; an existing id updates that row. */
  id?: string
  filename: string
  storageKey: string
  mimeType: string
  byteSize: number
  width?: number | null
  height?: number | null
  altText?: string | null
}

export interface PageWrite {
  id?: string
  title: string
  slug: string
  blocks?: BlockContent
  seo?: SeoMetadata
  status?: ContentStatus
  sortOrder?: number
}

export interface PostWrite {
  id?: string
  title: string
  slug: string
  excerpt?: string | null
  coverMediaId?: string | null
  blocks?: BlockContent
  tags?: string[]
  category?: string | null
  seo?: SeoMetadata
  status?: ContentStatus
}

export interface ProductWrite {
  id?: string
  title: string
  slug: string
  summary?: string | null
  blocks?: BlockContent
  coverMediaId?: string | null
  gallery?: string[]
  specs?: ProductSpec[]
  priceLabel?: string | null
  ctaLabel?: string | null
  ctaUrl?: string | null
  seo?: SeoMetadata
  status?: ContentStatus
  sortOrder?: number
}

export interface ThemeTemplateWrite {
  /** Defaults to `default`. */
  theme?: string
  path: string
  source: string
}

/* --------------------------------------------------------------- queries -- */

export interface PageResult<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface ListQuery {
  status?: ContentStatus
  limit?: number
  offset?: number
}

export interface ListPostsQuery extends ListQuery {
  category?: string
  /** Case-insensitive match on title, slug or excerpt. */
  search?: string
}

export interface ListMediaQuery {
  /** Case-insensitive match on filename or alt text. */
  search?: string
  limit?: number
  offset?: number
}

/**
 * Neutralises the wildcards in a search term before it reaches `LIKE`.
 *
 * Without this, a search for `100%` matches every row and `a_b` matches `aXb`:
 * the operator gets a confident wrong answer rather than an error, which is the
 * worse failure. The escape character is the backslash, which is why it is
 * escaped first.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`)
}

export const DEFAULT_PAGE_LIMIT = 20
export const MAX_PAGE_LIMIT = 100

/** Clamps a requested window into something a single query should load. */
export function resolveWindow(query: { limit?: number; offset?: number }): {
  limit: number
  offset: number
} {
  const limit = Math.min(Math.max(query.limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT)
  const offset = Math.max(query.offset ?? 0, 0)
  return { limit, offset }
}
