// GENERATED FILE -- do not edit by hand.
// Source of truth: packages/core/src/model/schema.ts
// Regenerate with `pnpm db:generate`; `pnpm check:schema-drift` fails when this
// file and the model disagree.
//
// Columns use raw SQLite types on purpose. Every value conversion -- JSON,
// booleans, timestamps -- goes through the codec in @typeky/core, which is the
// only read and write path for stored values (architecture section 5.2).

import { foreignKey, index, integer, sqliteTable, text, unique, uniqueIndex } from 'drizzle-orm/sqlite-core'
import { sql } from 'drizzle-orm'

export const media = sqliteTable('media', {
  id: text('id').primaryKey(),
  filename: text('filename').notNull(),
  storageKey: text('storage_key').notNull(),
  mimeType: text('mime_type').notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer('width'),
  height: integer('height'),
  altText: text('alt_text'),
  createdAt: text('created_at').notNull(),
}, (t) => [
  index('idx_media_created').on(sql`${t.createdAt} DESC`),
])

export const sites = sqliteTable('sites', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tagline: text('tagline'),
  logoMediaId: text('logo_media_id').references(() => media.id, { onDelete: 'set null' }),
  faviconMediaId: text('favicon_media_id').references(() => media.id, { onDelete: 'set null' }),
  theme: text('theme').notNull().default('default'),
  settings: text('settings').notNull().default('{}'),
  nav: text('nav').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const pages = sqliteTable('pages', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  contentBlocks: text('content_blocks').notNull().default('[]'),
  useLayout: integer('use_layout').notNull().default(1),
  customSource: text('custom_source'),
  seoMetadata: text('seo_metadata').notNull().default('{}'),
  status: text('status').notNull().default('draft'),
  isHome: integer('is_home').notNull().default(0),
  sortOrder: integer('sort_order').notNull().default(0),
  revision: integer('revision').notNull().default(1),
  publishedAt: text('published_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_pages_status').on(t.status, t.sortOrder),
  uniqueIndex('uq_pages_home').on(t.isHome).where(sql`is_home = 1`),
])

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  excerpt: text('excerpt'),
  coverMediaId: text('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
  contentBlocks: text('content_blocks').notNull().default('[]'),
  tags: text('tags').notNull().default('[]'),
  seoMetadata: text('seo_metadata').notNull().default('{}'),
  status: text('status').notNull().default('draft'),
  revision: integer('revision').notNull().default(1),
  publishedAt: text('published_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_posts_published').on(t.status, sql`${t.publishedAt} DESC`),
])

export const products = sqliteTable('products', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  slug: text('slug').notNull().unique(),
  summary: text('summary'),
  contentBlocks: text('content_blocks').notNull().default('[]'),
  coverMediaId: text('cover_media_id').references(() => media.id, { onDelete: 'set null' }),
  gallery: text('gallery').notNull().default('[]'),
  specs: text('specs').notNull().default('[]'),
  priceLabel: text('price_label'),
  ctaLabel: text('cta_label'),
  ctaUrl: text('cta_url'),
  seoMetadata: text('seo_metadata').notNull().default('{}'),
  status: text('status').notNull().default('draft'),
  sortOrder: integer('sort_order').notNull().default(0),
  revision: integer('revision').notNull().default(1),
  publishedAt: text('published_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_products_status').on(t.status, t.sortOrder),
])

export const themeTemplates = sqliteTable('theme_templates', {
  id: text('id').primaryKey(),
  theme: text('theme').notNull().default('default'),
  path: text('path').notNull(),
  source: text('source').notNull(),
  revision: integer('revision').notNull().default(1),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  unique().on(t.theme, t.path),
])

export const vocabularies = sqliteTable('vocabularies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  contentTypes: text('content_types').notNull().default('[]'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_vocabularies_sort').on(t.sortOrder),
  unique().on(t.name),
])

export const terms = sqliteTable('terms', {
  id: text('id').primaryKey(),
  vocabularyId: text('vocabulary_id').notNull().references(() => vocabularies.id, { onDelete: 'cascade' }),
  parentId: text('parent_id'),
  name: text('name').notNull(),
  slug: text('slug').notNull(),
  description: text('description'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (t) => [
  index('idx_terms_vocabulary').on(t.vocabularyId, t.sortOrder),
  index('idx_terms_parent').on(t.parentId),
  foreignKey({ columns: [t.parentId], foreignColumns: [t.id] }).onDelete('cascade'),
  unique().on(t.vocabularyId, t.slug),
])

export const contentTerms = sqliteTable('content_terms', {
  id: text('id').primaryKey(),
  contentType: text('content_type').notNull(),
  contentId: text('content_id').notNull(),
  termId: text('term_id').notNull().references(() => terms.id, { onDelete: 'cascade' }),
}, (t) => [
  index('idx_content_terms_content').on(t.contentType, t.contentId),
  index('idx_content_terms_term').on(t.termId),
  uniqueIndex('uq_content_terms').on(t.contentType, t.contentId, t.termId),
])
