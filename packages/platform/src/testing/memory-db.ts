import { DatabaseSync } from 'node:sqlite'
import type { DbPort, DbStatement, SqlParam } from '../ports'

/**
 * An in-memory SQLite `DbPort` for tests.
 *
 * Backed by Node's built-in SQLite, so unit tests exercise the same engine the
 * migration and the repositories target, with no container, no network and no
 * second driver. Never imported by application code: it pulls in a Node builtin
 * and would not load in a Worker.
 */
export interface MemoryDb extends DbPort {
  /** Runs a multi-statement script, such as a migration file. */
  exec(sql: string): void
  close(): void
}

export function createMemoryDb(): MemoryDb {
  const database = new DatabaseSync(':memory:')

  // D1 enforces foreign keys by default. Matching that here means a test cannot
  // pass on a schema that would then fail in production.
  database.exec('PRAGMA foreign_keys = ON')

  return {
    async all<T>(sql: string, params: SqlParam[] = []): Promise<T[]> {
      return database.prepare(sql).all(...params) as T[]
    },

    async first<T>(sql: string, params: SqlParam[] = []): Promise<T | null> {
      const row = database.prepare(sql).get(...params)
      return row === undefined ? null : (row as T)
    },

    async run(sql: string, params: SqlParam[] = []): Promise<number> {
      const result = database.prepare(sql).run(...params)
      return Number(result.changes)
    },

    async batch(statements: DbStatement[]): Promise<void> {
      if (statements.length === 0) return

      database.exec('BEGIN')
      try {
        for (const statement of statements) {
          database.prepare(statement.sql).run(...(statement.params ?? []))
        }
        database.exec('COMMIT')
      } catch (error) {
        database.exec('ROLLBACK')
        throw error
      }
    },

    exec(sql: string): void {
      database.exec(sql)
    },

    close(): void {
      database.close()
    },
  }
}
