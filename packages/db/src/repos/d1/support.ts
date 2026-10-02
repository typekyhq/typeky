import { decodeBoolean, decodeTimestamp } from '@typeky/core'

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
