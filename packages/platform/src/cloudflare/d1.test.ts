import { describe, expect, it } from 'vitest'
import type { SqlParam } from '../ports'
import { createD1DbPort, type D1LikeDatabase, type D1LikePreparedStatement } from './d1'

interface Call {
  sql: string
  params: SqlParam[]
}

/**
 * A stand-in for the D1 binding that records what it was asked to do. Enough of
 * the surface to prove the port plumbing -- SQL text, bound parameters, result
 * unwrapping, batch fan-out -- without booting a Workers runtime.
 */
function createFakeD1(options: { rows?: unknown[]; changes?: number } = {}) {
  const calls: Call[] = []
  let batched: D1LikePreparedStatement[] = []

  const makeStatement = (record: Call): D1LikePreparedStatement => ({
    bind: (...values: SqlParam[]) => {
      record.params = values
      return makeStatement(record)
    },
    all: async <T>() => ({ results: (options.rows ?? []) as T[] }),
    first: async <T>() => (((options.rows ?? [])[0] ?? null) as T | null),
    // Mirrors D1 faithfully: `meta.changes` is optional, so the adapter's
    // fallback path is reachable rather than hidden by the double.
    run: async () => (options.changes === undefined ? { meta: {} } : { meta: { changes: options.changes } }),
  })

  const database: D1LikeDatabase = {
    prepare(sql: string) {
      const record: Call = { sql, params: [] }
      calls.push(record)
      return makeStatement(record)
    },
    async batch(statements: D1LikePreparedStatement[]) {
      batched = statements
    },
  }

  return { database, calls, batched: () => batched }
}

describe('createD1DbPort', () => {
  it('returns every row from all', async () => {
    const fake = createFakeD1({ rows: [{ id: 'a' }, { id: 'b' }] })
    const db = createD1DbPort(fake.database)

    await expect(db.all<{ id: string }>('SELECT id FROM posts')).resolves.toEqual([{ id: 'a' }, { id: 'b' }])
  })

  it('passes the SQL and the bound parameters through unchanged', async () => {
    const fake = createFakeD1({ rows: [] })
    const db = createD1DbPort(fake.database)

    await db.all('SELECT id FROM posts WHERE slug = ? AND status = ?', ['hello', 'published'])

    expect(fake.calls).toEqual([
      { sql: 'SELECT id FROM posts WHERE slug = ? AND status = ?', params: ['hello', 'published'] },
    ])
  })

  it('does not bind when there are no parameters', async () => {
    const fake = createFakeD1({ rows: [] })
    const db = createD1DbPort(fake.database)

    await db.all('SELECT 1')

    expect(fake.calls).toEqual([{ sql: 'SELECT 1', params: [] }])
  })

  it('returns null from first when the result set is empty', async () => {
    const fake = createFakeD1({ rows: [] })
    const db = createD1DbPort(fake.database)

    await expect(db.first('SELECT id FROM posts LIMIT 1')).resolves.toBeNull()
  })

  it('reports the changed row count from run', async () => {
    const fake = createFakeD1({ changes: 3 })
    const db = createD1DbPort(fake.database)

    await expect(db.run('DELETE FROM posts WHERE status = ?', ['draft'])).resolves.toBe(3)
  })

  it('defaults the changed row count to zero when the binding omits it', async () => {
    const fake = createFakeD1()
    const db = createD1DbPort(fake.database)

    await expect(db.run('DELETE FROM posts')).resolves.toBe(0)
  })

  it('forwards every statement to batch', async () => {
    const fake = createFakeD1()
    const db = createD1DbPort(fake.database)

    await db.batch([
      { sql: 'UPDATE pages SET is_home = 0' },
      { sql: 'UPDATE pages SET is_home = 1 WHERE id = ?', params: ['p1'] },
    ])

    expect(fake.calls).toEqual([
      { sql: 'UPDATE pages SET is_home = 0', params: [] },
      { sql: 'UPDATE pages SET is_home = 1 WHERE id = ?', params: ['p1'] },
    ])
    expect(fake.batched()).toHaveLength(2)
  })

  it('does not call the binding at all for an empty batch', async () => {
    const fake = createFakeD1()
    const db = createD1DbPort(fake.database)

    await db.batch([])

    expect(fake.calls).toEqual([])
    expect(fake.batched()).toHaveLength(0)
  })
})
