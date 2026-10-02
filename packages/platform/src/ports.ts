/**
 * Platform ports. Business and data packages depend on these interfaces, never
 * on the Cloudflare bindings themselves (CONTRIBUTING.md section 3, red line 3).
 *
 * `apps/*` builds a port from the real binding and injects it at the
 * composition root, so nothing below this file knows which platform it runs on.
 */

/**
 * Values a port can bind as a statement parameter.
 *
 * Notably absent: booleans. Neither D1 nor SQLite accepts them, which is why
 * `@typeky/core/codec` converts booleans to 0 and 1 before they get here.
 */
export type SqlParam = string | number | null

export interface DbStatement {
  sql: string
  params?: SqlParam[]
}

/**
 * The data access surface repositories are written against.
 *
 * Deliberately small. Repositories express intent in SQL and this port hides
 * how that SQL is delivered, which is the part that actually differs between
 * SQLite (D1) and PostgreSQL.
 */
export interface DbPort {
  /** Runs a query and returns every row. */
  all<T>(sql: string, params?: SqlParam[]): Promise<T[]>
  /** Runs a query and returns the first row, or null. */
  first<T>(sql: string, params?: SqlParam[]): Promise<T | null>
  /** Runs a write and returns the number of affected rows. */
  run(sql: string, params?: SqlParam[]): Promise<number>
  /**
   * Runs several statements as one atomic unit. SQLite has no interactive
   * transactions over D1, so `batch` is its transaction primitive
   * (architecture section 5.2).
   */
  batch(statements: DbStatement[]): Promise<void>
}
