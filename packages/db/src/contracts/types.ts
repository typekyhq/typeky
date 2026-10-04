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
  /** Paths kept free for something other than a page; see `PLATFORM_PATHS`. */
  reservedPaths?: string[]
}

export interface Site {
  id: string
  name: string
  tagline: string | null
  logoMediaId: string | null
  faviconMediaId: string | null
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
  /**
   * False means the page is its own document, rendered from `customSource`
   * rather than through the theme's layout.
   */
  useLayout: boolean
  /** Liquid source of a page that is its own document. Unused when `useLayout`. */
  customSource: string | null
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
  /**
   * What an uploaded theme shipped this file as, or null for a bundled template.
   *
   * The original is kept so an edit can be undone in place. For the bundled theme
   * the baseline is in code, so there is nothing to keep here and dropping the row
   * is the undo.
   */
  originalSource: string | null
  revision: number
  updatedAt: Date
}

/** One theme, as the settings screen and the theme page need it. */
export interface ThemeSummary {
  name: string
  /** How many files the theme has. At least one: an empty theme is not one. */
  files: number
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
  faviconMediaId?: string | null
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

/**
 * The metadata an edit may change.
 *
 * The bytes and the storage key are deliberately absent: those are what content
 * references, and re-uploading is how they change. Alt text is the field a person
 * comes back to fix, because it is written for a screen reader and that is rarely
 * the sentence that was to hand at upload time.
 */
export interface MediaMetadataWrite {
  altText: string | null
}

export interface PageWrite {
  id?: string
  title: string
  slug: string
  blocks?: BlockContent
  useLayout?: boolean
  customSource?: string | null
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
  /**
   * The uploaded original. Only a write that is *adding* a theme sets it: an edit
   * must leave whatever the upload recorded, or the undo would forget it.
   */
  originalSource?: string | null
}

/* -------------------------------------------------------------- taxonomy -- */

/*
 * Taxonomies, the Drupal way: a vocabulary is a named container of terms, and a
 * vocabulary says which content types may draw from it. A term may point at a
 * parent, which is what makes a vocabulary a tree rather than a list.
 *
 * This replaces a single text column on the content type. The difference is not
 * the shape of the form -- it is that a term exists independently of the content
 * that uses it. That is what lets it be renamed once, reused by several posts,
 * nested, and counted.
 */

/** The content types a vocabulary may be attached to. */
export type ContentType = 'post' | 'product'

export interface Vocabulary {
  id: string
  name: string
  description: string | null
  /** The content types allowed to draw from this vocabulary. */
  contentTypes: ContentType[]
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface Term {
  id: string
  vocabularyId: string
  /** `null` for a root term. */
  parentId: string | null
  name: string
  slug: string
  description: string | null
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

/**
 * One piece of published content carrying a term, for the term's archive page.
 *
 * Only what the archive needs to load the row it points at and order the list:
 * the content itself is read by id, because a post and a product are two shapes
 * and flattening them here would be inventing a third.
 */
export interface TermContent {
  id: string
  contentType: ContentType
  updatedAt: Date
}

/** A term with its children attached, which is how the admin tree renders it. */
export interface TermNode extends Term {
  children: TermNode[]
}

export interface VocabularyWrite {
  id?: string
  name: string
  description?: string | null
  contentTypes?: ContentType[]
  sortOrder?: number
}

export interface TermWrite {
  id?: string
  vocabularyId: string
  parentId?: string | null
  name: string
  slug: string
  description?: string | null
  sortOrder?: number
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
  /** Case-insensitive match on the resource's own text columns. */
  search?: string
  /** Which column to order by; unknown values fall back to the natural order. */
  sort?: ContentSort
  direction?: SortDirection
  limit?: number
  offset?: number
}

/**
 * The columns a list may be ordered by.
 *
 * A closed set rather than a column name, because this value ends up in the SQL
 * text: the caller picks a key, and the key selects a statement this package
 * wrote (see `orderByClause`).
 */
export type ContentSort = 'published' | 'updated' | 'created' | 'title' | 'order'

export type SortDirection = 'asc' | 'desc'

export const CONTENT_SORTS: readonly ContentSort[] = [
  'published',
  'updated',
  'created',
  'title',
  'order',
]

export const SORT_DIRECTIONS: readonly SortDirection[] = ['asc', 'desc']

export interface ListMediaQuery {
  /** Case-insensitive match on filename or alt text. */
  search?: string
  limit?: number
  offset?: number
}

/** One kind of content that references a piece of media. */
export interface MediaUsagePlace {
  kind: 'post' | 'page' | 'product' | 'site'
  count: number
}

export interface MediaUsage {
  /** How many content rows reference it, counting each row once. */
  total: number
  places: MediaUsagePlace[]
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
