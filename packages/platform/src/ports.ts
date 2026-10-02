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

/** An object read back from blob storage. */
export interface BlobContents {
  /** The caller owns this and should stream it on rather than buffer it. */
  body: ReadableStream
  contentType: string | null
  byteSize: number
}

/**
 * The object storage surface.
 *
 * `signedUrl` is absent on purpose. Direct-to-R2 uploads need an S3 token that
 * the Worker's binding does not provide, and uploads through the Worker are
 * simpler to deploy: same origin, no extra secret, and a photo is far below the
 * request-size limit. That is a decision, not an omission, and it is recorded
 * where decisions live.
 *
 * Bodies are streams in both directions. A Worker has a fixed memory budget, and
 * a photograph can be most of it.
 */
export interface BlobPort {
  /**
   * Stores an object and answers with its size.
   *
   * The size comes back from the store rather than from the caller: an upload
   * truncated on the wire has to be recorded as the length it really has, or the
   * media row disagrees with the object it points at.
   */
  put(key: string, body: ReadableStream, contentType: string): Promise<{ byteSize: number }>
  get(key: string): Promise<BlobContents | null>
  delete(key: string): Promise<void>
}
