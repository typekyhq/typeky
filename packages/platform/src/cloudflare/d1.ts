import type { DbPort, DbStatement, SqlParam } from '../ports'

/**
 * The subset of the Cloudflare D1 binding this adapter touches.
 *
 * Written structurally on purpose. Importing `D1Database` would drag a
 * Cloudflare binding type into the codebase, which red line 3 forbids, and
 * would also clash with the Node types the in-memory adapter needs. The real
 * `env.DB` is assignable to this shape, and the composition root in
 * `apps/site` is where any drift would surface as a type error.
 */
export interface D1LikeResult<T> {
  results?: T[]
  meta?: { changes?: number }
}

export interface D1LikePreparedStatement {
  bind(...values: SqlParam[]): D1LikePreparedStatement
  all<T>(): Promise<D1LikeResult<T>>
  first<T>(): Promise<T | null>
  run(): Promise<D1LikeResult<unknown>>
}

export interface D1LikeDatabase {
  prepare(sql: string): D1LikePreparedStatement
  batch(statements: D1LikePreparedStatement[]): Promise<unknown>
}

export function createD1DbPort(database: D1LikeDatabase): DbPort {
  const prepare = (sql: string, params: SqlParam[] = []): D1LikePreparedStatement => {
    const statement = database.prepare(sql)
    return params.length > 0 ? statement.bind(...params) : statement
  }

  return {
    async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      const result = await prepare(sql, params).all<T>()
      return result.results ?? []
    },

    async first<T>(sql: string, params: SqlParam[] = []): Promise<T | null> {
      return prepare(sql, params).first<T>()
    },

    async run(sql: string, params: SqlParam[] = []): Promise<number> {
      const result = await prepare(sql, params).run()
      return result.meta?.changes ?? 0
    },

    async batch(statements: DbStatement[]): Promise<void> {
      if (statements.length === 0) return
      await database.batch(statements.map(({ sql, params }) => prepare(sql, params)))
    },
  }
}
