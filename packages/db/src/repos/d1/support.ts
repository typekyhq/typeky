import { decodeBoolean, decodeTimestamp } from '@typeky/core'
import type { SqlParam } from '@typeky/platform'
import { escapeLikeTerm } from '../../contracts'

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
