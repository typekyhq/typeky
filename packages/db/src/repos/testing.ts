import { model } from '@typeky/core'
import { createMemoryDb, type MemoryDb } from '@typeky/platform/testing'
import { renderMigrationSql } from '../generate'

/**
 * A migrated in-memory database for repository tests.
 *
 * The DDL is rendered from the same model the migration file comes from, so the
 * tests cannot drift onto a schema the deployed database does not have. Not
 * exported from the package root: it pulls in `node:sqlite`.
 */
export function createTestDatabase(): MemoryDb {
  const db = createMemoryDb()
  db.exec(renderMigrationSql(model))
  return db
}
