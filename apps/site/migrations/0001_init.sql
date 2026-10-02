-- Generated from packages/core/src/model/schema.ts -- do not edit by hand.
-- Regenerate with `pnpm db:generate`; `pnpm check:schema-drift` fails when
-- this file and the model disagree.
--
-- Bootstrap migration. Apply it with `wrangler d1 migrations apply`.
-- Once it has been applied to a deployed database, treat it as frozen: add the
-- next numbered migration by hand instead of rewriting this one.

-- ===== media =====
-- Uploaded media. R2 holds the bytes, this table holds the metadata.
CREATE TABLE media (
  id          TEXT PRIMARY KEY NOT NULL,
  filename    TEXT NOT NULL,
  storage_key TEXT NOT NULL,              -- R2 object key
  mime_type   TEXT NOT NULL,
  byte_size   INTEGER NOT NULL,
  width       INTEGER,
  height      INTEGER,
  alt_text    TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_media_created ON media(created_at DESC);

-- ===== sites =====
-- The site itself. A CE deployment hosts a single site, so this holds exactly
-- one row.
CREATE TABLE sites (
  id            TEXT PRIMARY KEY NOT NULL,                     -- fixed to 'default'
  name          TEXT NOT NULL,
  tagline       TEXT,
  logo_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  theme         TEXT NOT NULL DEFAULT 'default',
  settings      TEXT NOT NULL DEFAULT '{}',                    -- accent colour, social links, SEO defaults, footer copy
  nav           TEXT NOT NULL DEFAULT '[]',                    -- navigation items: [{ label, href, order }]
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- ===== pages =====
CREATE TABLE pages (
  id             TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  content_blocks TEXT NOT NULL DEFAULT '[]',     -- Block JSON
  seo_metadata   TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'draft',  -- draft | published
  is_home        INTEGER NOT NULL DEFAULT 0,     -- at most one row may be 1
  sort_order     INTEGER NOT NULL DEFAULT 0,
  revision       INTEGER NOT NULL DEFAULT 1,     -- bumped on publish, drives precise cache invalidation
  published_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_pages_status ON pages(status, sort_order);
CREATE UNIQUE INDEX uq_pages_home ON pages(is_home) WHERE is_home = 1;

-- ===== posts =====
CREATE TABLE posts (
  id             TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  excerpt        TEXT,
  cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  content_blocks TEXT NOT NULL DEFAULT '[]',                    -- Block JSON
  tags           TEXT NOT NULL DEFAULT '[]',                    -- string array; MVP has no separate tag table
  category       TEXT,                                          -- single category
  seo_metadata   TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'draft',                 -- draft | published
  revision       INTEGER NOT NULL DEFAULT 1,                    -- bumped on publish, drives precise cache invalidation
  published_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_posts_published ON posts(status, published_at DESC);
CREATE INDEX idx_posts_category ON posts(category);

-- ===== products =====
-- Showcase products only. Prices are display labels; CE does not take orders.
CREATE TABLE products (
  id             TEXT PRIMARY KEY NOT NULL,
  title          TEXT NOT NULL,
  slug           TEXT NOT NULL UNIQUE,
  summary        TEXT,
  content_blocks TEXT NOT NULL DEFAULT '[]',                    -- Block JSON
  cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  gallery        TEXT NOT NULL DEFAULT '[]',                    -- array of media ids
  specs          TEXT NOT NULL DEFAULT '[]',                    -- [{ label, value }]
  price_label    TEXT,                                          -- display text such as "199 USD"
  cta_label      TEXT,
  cta_url        TEXT,
  seo_metadata   TEXT NOT NULL DEFAULT '{}',
  status         TEXT NOT NULL DEFAULT 'draft',                 -- draft | published
  sort_order     INTEGER NOT NULL DEFAULT 0,
  revision       INTEGER NOT NULL DEFAULT 1,                    -- bumped on publish, drives precise cache invalidation
  published_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);
CREATE INDEX idx_products_status ON products(status, sort_order);

-- ===== theme_templates =====
-- Site-level template overrides. Lookup order is override, then bundled
-- baseline. Deleting an override row restores the theme default, so no
-- separate version table is needed.
CREATE TABLE theme_templates (
  id         TEXT PRIMARY KEY NOT NULL,
  theme      TEXT NOT NULL DEFAULT 'default',
  path       TEXT NOT NULL,                    -- 'templates/post' | 'snippets/header' | 'layouts/base'
  source     TEXT NOT NULL,
  revision   INTEGER NOT NULL DEFAULT 1,       -- bumped on every save, drives precise cache invalidation
  updated_at TEXT NOT NULL,
  UNIQUE (theme, path)
);

-- ===== vocabularies =====
-- A named set of terms. Bound to content types rather than to one of them.
CREATE TABLE vocabularies (
  id            TEXT PRIMARY KEY NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  content_types TEXT NOT NULL DEFAULT '[]',  -- which content types may use it: 'post' | 'product'
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (name)
);
CREATE INDEX idx_vocabularies_sort ON vocabularies(sort_order);

-- ===== terms =====
-- One term. `parent_id` is a self-reference, which is what makes it a tree.
CREATE TABLE terms (
  id            TEXT PRIMARY KEY NOT NULL,
  vocabulary_id TEXT NOT NULL REFERENCES vocabularies(id) ON DELETE CASCADE,
  parent_id     TEXT REFERENCES terms(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL,
  description   TEXT,
  sort_order    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (vocabulary_id, slug)
);
CREATE INDEX idx_terms_vocabulary ON terms(vocabulary_id, sort_order);
CREATE INDEX idx_terms_parent ON terms(parent_id);

-- ===== content_terms =====
-- Which terms a post or a product carries.
CREATE TABLE content_terms (
  id           TEXT PRIMARY KEY NOT NULL,
  content_type TEXT NOT NULL,                                        -- 'post' | 'product'
  content_id   TEXT NOT NULL,
  term_id      TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE
);
CREATE INDEX idx_content_terms_content ON content_terms(content_type, content_id);
CREATE INDEX idx_content_terms_term ON content_terms(term_id);
CREATE UNIQUE INDEX uq_content_terms ON content_terms(content_type, content_id, term_id);
