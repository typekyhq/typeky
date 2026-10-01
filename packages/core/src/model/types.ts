/**
 * Language-neutral description of the persistence model.
 *
 * This is the single source of truth for table names, column names, types,
 * constraints, indexes and relations (architecture section 5.1). Both the
 * Drizzle schema and the DDL migration are generated from it:
 *
 *   this file --> packages/db/src/d1/schema.ts   (Drizzle, SQLite)
 *             --> apps/site/migrations/*.sql     (DDL)
 *
 * Editing a table here without regenerating is caught by
 * `pnpm check:schema-drift`, which is part of `pnpm check`.
 */

/** Storage intent, independent of any dialect's concrete column type. */
export type LogicalType =
  /** Application-generated UUIDv7. A 36 character string. */
  | 'uuid'
  | 'text'
  | 'integer'
  /** Stored as 0 or 1. */
  | 'boolean'
  /** JSON string, encoded and decoded by the codec in `@typeky/core`. */
  | 'json'
  /** ISO 8601 UTC string. Lexicographic order matches chronological order. */
  | 'timestamp'

export interface ReferenceDef {
  table: string
  column: string
  onDelete?: 'cascade' | 'set null' | 'restrict'
}

export interface ColumnDef {
  name: string
  type: LogicalType
  notNull?: boolean
  primaryKey?: boolean
  unique?: boolean
  /** SQL literal of the column default, already quoted, for example `'{}'` or `1`. */
  defaultSql?: string
  references?: ReferenceDef
  /** Trailing comment in the generated DDL. */
  note?: string
}

/** A column reference inside an index. The object form adds a sort direction. */
export type IndexColumnRef = string | { column: string; desc?: boolean }

export interface IndexDef {
  name: string
  columns: IndexColumnRef[]
  unique?: boolean
  /** Partial index predicate, emitted verbatim after WHERE. */
  where?: string
}

/** Table-level UNIQUE constraint spanning several columns. */
export interface UniqueDef {
  columns: string[]
}

export interface TableDef {
  name: string
  /** Comment emitted above the table in the generated DDL. */
  note?: string
  columns: ColumnDef[]
  uniques?: UniqueDef[]
  indexes?: IndexDef[]
}

export interface LogicalModel {
  /** Bumped when this descriptor format changes, not when tables change. */
  formatVersion: 1
  tables: TableDef[]
}
