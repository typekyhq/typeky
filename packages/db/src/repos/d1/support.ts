import { decodeBoolean, decodeTimestamp, nowIso } from '@typeky/core'
import type { DbPort, SqlParam } from '@typeky/platform'
import { escapeLikeTerm, type ContentSort, type ContentStatus, type SortDirection } from '../../contracts'

/**
 * Row decoding helpers for columns the schema declares NOT NULL.
 *
 * The codec returns `T | null` because a column may be nullable; these narrow the
 * cases where the model guarantees a value, and throw rather than assert, so a
 * contradictory row is loud instead of silently producing `undefined`.
 */

export function asDate(text: string): Date {
  const value = decodeTimestamp(text)
  if (value === null) throw new Error('expected a NOT NULL timestamp column, received null')
  return value
}

export function asBoolean(value: number): boolean {
  const decoded = decodeBoolean(value)
  if (decoded === null) throw new Error('expected a NOT NULL boolean column, received null')
  return decoded
}

/**
 * A case-insensitive match across the given columns.
 *
 * Three details that each cost correctness if left out:
 *
 *   - `lower()` on both sides rather than `LIKE`, which SQLite only folds for
 *     ASCII, so a search for `CAFÉ` would not find `café`.
 *   - the term is escaped, so `100%` is a percentage rather than "everything".
 *   - `coalesce` on the column, because a null comparison is null, and a null
 *     condition is not false in the way the surrounding `AND` expects.
 *
 * Column names are literals from this package, never caller input, which is why
 * they can be interpolated.
 */
export function searchAcross(columns: string[], term: string): { sql: string; params: SqlParam[] } {
  const pattern = `%${escapeLikeTerm(term.trim().toLowerCase())}%`

  const sql = `(${columns
    .map((column) => `lower(coalesce(${column}, '')) LIKE ? ESCAPE '\\'`)
    .join(' OR ')})`

  return { sql, params: columns.map(() => pattern) }
}

/**
 * An `ORDER BY` chosen from a whitelist.
 *
 * Sorting is the one place a request value would otherwise reach the SQL text
 * instead of the parameter list, so it never does: the caller picks a key, and
 * the key selects a statement this package wrote. An unknown key falls back
 * rather than failing, because a stale bookmark should still show a list.
 *
 * `id` is always appended. Two rows can share a timestamp, and without a total
 * order two pages of the same list can repeat or skip a row.
 */
export function orderByClause(
  columns: Partial<Record<ContentSort, string>>,
  sort: ContentSort | undefined,
  direction: SortDirection | undefined,
  fallback: string,
): string {
  const column = sort === undefined ? undefined : columns[sort]
  if (column === undefined) return fallback

  return `${column} ${direction === 'desc' ? 'DESC' : 'ASC'}, id ASC`
}

/**
 * One statement for many rows, so a bulk action is one trip to the database
 * rather than one per row.
 *
 * `published_at` is filled on the way to published and cleared on the way back,
 * with `coalesce` keeping the original date -- the same rule the single-row write
 * applies, and the reason a post that is unpublished and republished does not
 * appear to have been written today.
 */
export async function setStatusMany(
  db: DbPort,
  table: string,
  ids: string[],
  status: ContentStatus,
): Promise<number> {
  if (ids.length === 0) return 0

  const marks = ids.map(() => '?').join(', ')
  const now = nowIso()

  return db.run(
    `UPDATE ${table}
        SET status = ?,
            revision = revision + 1,
            published_at = CASE WHEN ? = 'published' THEN coalesce(published_at, ?) ELSE NULL END,
            updated_at = ?
      WHERE id IN (${marks})`,
    [status, status, now, now, ...ids],
  )
}

/** Removes many rows in one statement, answering how many were there. */
export async function deleteMany(db: DbPort, table: string, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0

  return db.run(`DELETE FROM ${table} WHERE id IN (${ids.map(() => '?').join(', ')})`, ids)
}
