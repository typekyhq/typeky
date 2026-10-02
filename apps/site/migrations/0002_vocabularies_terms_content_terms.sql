-- An appended migration, generated from packages/core/src/model/schema.ts.
-- Do not edit by hand; write a new migration instead.
--
-- SQLite applies one statement at a time and has no transactional DDL, so each
-- statement below is on its own: a failure halfway leaves the earlier ones
-- applied. `pnpm db:generate` refuses changes that cannot be expressed this way
-- rather than rebuilding a table, because dropping a table loses its rows.
--
-- Tables in the model when this was written: 9.

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
