-- An appended migration, generated from packages/core/src/model/schema.ts.
-- Do not edit by hand; write a new migration instead.
--
-- SQLite applies one statement at a time and has no transactional DDL, so each
-- statement below is on its own: a failure halfway leaves the earlier ones
-- applied. `pnpm db:generate` refuses changes that cannot be expressed this way
-- rather than rebuilding a table, because dropping a table loses its rows.
--
-- Tables in the model when this was written: 9.

DROP INDEX idx_posts_category;
-- Dropped from the model. This deletes the column's values.
ALTER TABLE posts DROP COLUMN category;
