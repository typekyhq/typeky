import type { LogicalModel, TableDef } from './types'

/**
 * CE MVP persistence model: six tables, no tenant column, no custom content
 * models, no commerce (architecture section 6.1).
 *
 * Declaration order matters: a table may only reference tables declared before
 * it, so the generated Drizzle schema needs no forward declarations. `media` is
 * therefore the first table, since sites, posts and products all point at it.
 */

const media: TableDef = {
  name: 'media',
  note: 'Uploaded media. R2 holds the bytes, this table holds the metadata.',
  columns: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'filename', type: 'text', notNull: true },
    { name: 'storage_key', type: 'text', notNull: true, note: 'R2 object key' },
    { name: 'mime_type', type: 'text', notNull: true },
    { name: 'byte_size', type: 'integer', notNull: true },
    { name: 'width', type: 'integer' },
    { name: 'height', type: 'integer' },
    { name: 'alt_text', type: 'text' },
    { name: 'created_at', type: 'timestamp', notNull: true },
  ],
  indexes: [{ name: 'idx_media_created', columns: [{ column: 'created_at', desc: true }] }],
}

const sites: TableDef = {
  name: 'sites',
  note: 'The site itself. A CE deployment hosts a single site, so this holds exactly one row.',
  columns: [
    { name: 'id', type: 'uuid', primaryKey: true, note: "fixed to 'default'" },
    { name: 'name', type: 'text', notNull: true },
    { name: 'tagline', type: 'text' },
    {
      name: 'logo_media_id',
      type: 'uuid',
      references: { table: 'media', column: 'id', onDelete: 'set null' },
    },
    { name: 'theme', type: 'text', notNull: true, defaultSql: "'default'" },
    {
      name: 'settings',
      type: 'json',
      notNull: true,
      defaultSql: "'{}'",
      note: 'accent colour, social links, SEO defaults, footer copy',
    },
    {
      name: 'nav',
      type: 'json',
      notNull: true,
      defaultSql: "'[]'",
      note: 'navigation items: [{ label, href, order }]',
    },
    { name: 'created_at', type: 'timestamp', notNull: true },
    { name: 'updated_at', type: 'timestamp', notNull: true },
  ],
}

const pages: TableDef = {
  name: 'pages',
  columns: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'title', type: 'text', notNull: true },
    { name: 'slug', type: 'text', notNull: true, unique: true },
    { name: 'content_blocks', type: 'json', notNull: true, defaultSql: "'[]'", note: 'Block JSON' },
    { name: 'seo_metadata', type: 'json', notNull: true, defaultSql: "'{}'" },
    { name: 'status', type: 'text', notNull: true, defaultSql: "'draft'", note: 'draft | published' },
    { name: 'is_home', type: 'boolean', notNull: true, defaultSql: '0', note: 'at most one row may be 1' },
    { name: 'sort_order', type: 'integer', notNull: true, defaultSql: '0' },
    {
      name: 'revision',
      type: 'integer',
      notNull: true,
      defaultSql: '1',
      note: 'bumped on publish, drives precise cache invalidation',
    },
    { name: 'published_at', type: 'timestamp' },
    { name: 'created_at', type: 'timestamp', notNull: true },
    { name: 'updated_at', type: 'timestamp', notNull: true },
  ],
  indexes: [
    { name: 'idx_pages_status', columns: ['status', 'sort_order'] },
    { name: 'uq_pages_home', columns: ['is_home'], unique: true, where: 'is_home = 1' },
  ],
}

const posts: TableDef = {
  name: 'posts',
  columns: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'title', type: 'text', notNull: true },
    { name: 'slug', type: 'text', notNull: true, unique: true },
    { name: 'excerpt', type: 'text' },
    {
      name: 'cover_media_id',
      type: 'uuid',
      references: { table: 'media', column: 'id', onDelete: 'set null' },
    },
    { name: 'content_blocks', type: 'json', notNull: true, defaultSql: "'[]'", note: 'Block JSON' },
    {
      name: 'tags',
      type: 'json',
      notNull: true,
      defaultSql: "'[]'",
      note: 'string array; MVP has no separate tag table',
    },
    { name: 'category', type: 'text', note: 'single category' },
    { name: 'seo_metadata', type: 'json', notNull: true, defaultSql: "'{}'" },
    { name: 'status', type: 'text', notNull: true, defaultSql: "'draft'", note: 'draft | published' },
    {
      name: 'revision',
      type: 'integer',
      notNull: true,
      defaultSql: '1',
      note: 'bumped on publish, drives precise cache invalidation',
    },
    { name: 'published_at', type: 'timestamp' },
    { name: 'created_at', type: 'timestamp', notNull: true },
    { name: 'updated_at', type: 'timestamp', notNull: true },
  ],
  indexes: [
    { name: 'idx_posts_published', columns: ['status', { column: 'published_at', desc: true }] },
    { name: 'idx_posts_category', columns: ['category'] },
  ],
}

const products: TableDef = {
  name: 'products',
  note: 'Showcase products only. Prices are display labels; CE does not take orders.',
  columns: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'title', type: 'text', notNull: true },
    { name: 'slug', type: 'text', notNull: true, unique: true },
    { name: 'summary', type: 'text' },
    { name: 'content_blocks', type: 'json', notNull: true, defaultSql: "'[]'", note: 'Block JSON' },
    {
      name: 'cover_media_id',
      type: 'uuid',
      references: { table: 'media', column: 'id', onDelete: 'set null' },
    },
    { name: 'gallery', type: 'json', notNull: true, defaultSql: "'[]'", note: 'array of media ids' },
    { name: 'specs', type: 'json', notNull: true, defaultSql: "'[]'", note: '[{ label, value }]' },
    { name: 'price_label', type: 'text', note: 'display text such as "199 USD"' },
    { name: 'cta_label', type: 'text' },
    { name: 'cta_url', type: 'text' },
    { name: 'seo_metadata', type: 'json', notNull: true, defaultSql: "'{}'" },
    { name: 'status', type: 'text', notNull: true, defaultSql: "'draft'", note: 'draft | published' },
    { name: 'sort_order', type: 'integer', notNull: true, defaultSql: '0' },
    {
      name: 'revision',
      type: 'integer',
      notNull: true,
      defaultSql: '1',
      note: 'bumped on publish, drives precise cache invalidation',
    },
    { name: 'published_at', type: 'timestamp' },
    { name: 'created_at', type: 'timestamp', notNull: true },
    { name: 'updated_at', type: 'timestamp', notNull: true },
  ],
  indexes: [{ name: 'idx_products_status', columns: ['status', 'sort_order'] }],
}

const themeTemplates: TableDef = {
  name: 'theme_templates',
  note: [
    'Site-level template overrides. Lookup order is override, then bundled baseline.',
    'Deleting an override row restores the theme default, so no separate version table is needed.',
  ].join(' '),
  columns: [
    { name: 'id', type: 'uuid', primaryKey: true },
    { name: 'theme', type: 'text', notNull: true, defaultSql: "'default'" },
    {
      name: 'path',
      type: 'text',
      notNull: true,
      note: "'templates/post' | 'snippets/header' | 'layouts/base'",
    },
    { name: 'source', type: 'text', notNull: true },
    {
      name: 'revision',
      type: 'integer',
      notNull: true,
      defaultSql: '1',
      note: 'bumped on every save, drives precise cache invalidation',
    },
    { name: 'updated_at', type: 'timestamp', notNull: true },
  ],
  uniques: [{ columns: ['theme', 'path'] }],
}

export const model: LogicalModel = {
  formatVersion: 1,
  tables: [media, sites, pages, posts, products, themeTemplates],
}
