-- An appended migration, generated from packages/core/src/model/schema.ts.
-- Do not edit by hand; write a new migration instead.
--
-- SQLite applies one statement at a time and has no transactional DDL, so each
-- statement below is on its own: a failure halfway leaves the earlier ones
-- applied. `pnpm db:generate` refuses changes that cannot be expressed this way
-- rather than rebuilding a table, because dropping a table loses its rows.
--
-- Tables in the model when this was written: 9.

ALTER TABLE sites ADD COLUMN favicon_media_id TEXT REFERENCES media(id) ON DELETE SET NULL;
