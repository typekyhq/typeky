/**
 * Value conversion between stored columns and domain values.
 *
 * The single read and write path for stored values (architecture section 5.2).
 * SQLite has no boolean, JSON or date type, so every value crosses this boundary
 * on the way in and on the way out -- repositories must not convert inline, or
 * the two directions drift apart.
 *
 * Booleans in particular cannot simply be passed through: neither D1 nor SQLite
 * accepts a boolean as a bound parameter, so `encodeBoolean` is what keeps a
 * boolean out of a statement.
 */

/** What a boolean looks like in the database. */
export type StoredBoolean = 0 | 1

export function encodeJson(value: unknown): string {
  return JSON.stringify(value)
}

export function decodeJson<T>(text: string): T {
  return JSON.parse(text) as T
}

/** Decodes a JSON column that is nullable, mapping null through. */
export function decodeNullableJson<T>(text: string | null): T | null {
  return text === null ? null : decodeJson<T>(text)
}

export function encodeBoolean(value: boolean): StoredBoolean {
  return value ? 1 : 0
}

export function decodeBoolean(value: number | null): boolean | null {
  return value === null ? null : value !== 0
}

export function encodeTimestamp(value: Date): string {
  return value.toISOString()
}

export function decodeTimestamp(text: string | null): Date | null {
  return text === null ? null : new Date(text)
}

/** Current time in the stored format. Keeps `toISOString` calls out of callers. */
export function nowIso(): string {
  return new Date().toISOString()
}
