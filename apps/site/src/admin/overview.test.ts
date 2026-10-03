import { CSRF_HEADER } from '@typeky/api'
import { model } from '@typeky/core'
import { createD1Repositories, defaultContext, renderMigrationSql } from '@typeky/db'
import { createMemoryDb, type MemoryDb } from '@typeky/platform/testing'
import { beforeAll, describe, expect, it } from 'vitest'
import { fakeKv, makeTestEnv } from '../testing/env'
import { createAdminApi } from './api'
import type { AdminEnv } from './errors'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'

/**
 * The dashboard.
 *
 * Against the real repositories over an in-memory database, because what this
 * handler does is aggregate: the counts, the merge across three tables and the two
 * sorts are the whole of it, and a stub answering the same way I wrote it would
 * agree with me about all three.
 */

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

interface Overview {
  counts: Record<string, number | { published: number; draft: number }>
  drafts: { id: string; kind: string; title: string; status: string }[]
  lastPublished: { id: string; kind: string; title: string } | null
}

function setup() {
  const db = createMemoryDb()
  db.exec(renderMigrationSql(model))
  const repositories = createD1Repositories(db)

  const api = createAdminApi({ repositories: () => repositories })
  const env: AdminEnv['Bindings'] = makeTestEnv({
    CACHE: fakeKv().kv,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: passwordHash,
  })

  async function send(path: string, init?: RequestInit, cookie?: string): Promise<Response> {
    const headers = new Headers(init?.headers)
    if (cookie !== undefined) headers.set('cookie', cookie)
    return api.request(new Request(`https://example.com${path}`, { ...init, headers }), undefined, env)
  }

  async function asAdmin(): Promise<(path: string) => Promise<Response>> {
    const signIn = await send('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: PASSWORD }),
    })
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? ''

    return (path) => send(path, { method: 'GET', headers: { [CSRF_HEADER]: 'unused' } }, cookie)
  }

  return { db, repositories, send, asAdmin }
}

/**
 * A row's timestamps, set directly.
 *
 * Everything written in one test shares a millisecond, and the two lists the
 * dashboard builds are ordered by exactly those timestamps -- so the fixture says
 * when each row happened rather than hoping the order of writes survives the clock.
 */
async function stamp(
  db: MemoryDb,
  table: string,
  id: string,
  times: { updatedAt: string; publishedAt?: string },
): Promise<void> {
  await db.run(`UPDATE ${table} SET updated_at = ?, published_at = ? WHERE id = ?`, [
    times.updatedAt,
    times.publishedAt ?? null,
    id,
  ])
}

describe('the dashboard', () => {
  it('needs a session', async () => {
    const { send } = setup()

    expect((await send('/overview')).status).toBe(401)
  })

  it('reports nothing on a site with nothing in it', async () => {
    const { asAdmin } = setup()
    const get = await asAdmin()

    const body = (await (await get('/overview')).json()) as Overview

    expect(body.counts).toEqual({
      page: { published: 0, draft: 0 },
      post: { published: 0, draft: 0 },
      product: { published: 0, draft: 0 },
      media: 0,
    })
    expect(body.drafts).toEqual([])
    expect(body.lastPublished).toBeNull()
  })

  it('counts published and draft rows of each kind', async () => {
    const { asAdmin, repositories } = setup()
    const get = await asAdmin()
    const ctx = defaultContext()

    await repositories.posts.upsert(ctx, { title: 'A', slug: 'a', status: 'published' })
    await repositories.posts.upsert(ctx, { title: 'B', slug: 'b', status: 'published' })
    await repositories.posts.upsert(ctx, { title: 'C', slug: 'c', status: 'draft' })
    await repositories.pages.upsert(ctx, { title: 'Home', slug: 'home', status: 'published' })
    await repositories.products.upsert(ctx, { title: 'Lamp', slug: 'lamp', status: 'draft' })

    const body = (await (await get('/overview')).json()) as Overview

    expect(body.counts.post).toEqual({ published: 2, draft: 1 })
    expect(body.counts.page).toEqual({ published: 1, draft: 0 })
    expect(body.counts.product).toEqual({ published: 0, draft: 1 })
  })

  it('names the most recently written drafts, across all three kinds', async () => {
    const { asAdmin, repositories, db } = setup()
    const get = await asAdmin()
    const ctx = defaultContext()

    const old = await repositories.posts.upsert(ctx, { title: 'Old draft', slug: 'old', status: 'draft' })
    const middle = await repositories.pages.upsert(ctx, { title: 'Middle draft', slug: 'middle' })
    const recent = await repositories.products.upsert(ctx, { title: 'Recent draft', slug: 'recent' })

    await stamp(db, 'posts', old.id, { updatedAt: '2026-01-01T00:00:00.000Z' })
    await stamp(db, 'pages', middle.id, { updatedAt: '2026-03-01T00:00:00.000Z' })
    await stamp(db, 'products', recent.id, { updatedAt: '2026-02-01T00:00:00.000Z' })

    // A published row is not a draft, however recently it was written.
    const published = await repositories.posts.upsert(ctx, { title: 'Live', slug: 'live', status: 'published' })
    await stamp(db, 'posts', published.id, { updatedAt: '2026-04-01T00:00:00.000Z' })

    const body = (await (await get('/overview')).json()) as Overview

    expect(body.drafts.map((item) => item.title)).toEqual(['Middle draft', 'Recent draft', 'Old draft'])
    expect(body.drafts.map((item) => item.kind)).toEqual(['page', 'product', 'post'])
  })

  it('names what went live most recently, whichever kind it is', async () => {
    const { asAdmin, repositories, db } = setup()
    const get = await asAdmin()
    const ctx = defaultContext()

    const older = await repositories.posts.upsert(ctx, { title: 'Older', slug: 'older', status: 'published' })
    const newer = await repositories.pages.upsert(ctx, { title: 'Newer', slug: 'newer', status: 'published' })

    await stamp(db, 'posts', older.id, {
      updatedAt: '2026-01-01T00:00:00.000Z',
      publishedAt: '2026-01-01T00:00:00.000Z',
    })
    await stamp(db, 'pages', newer.id, {
      updatedAt: '2026-06-01T00:00:00.000Z',
      publishedAt: '2026-06-01T00:00:00.000Z',
    })

    const body = (await (await get('/overview')).json()) as Overview

    expect(body.lastPublished?.title).toBe('Newer')
    expect(body.lastPublished?.kind).toBe('page')
  })

  it('does not let a draft be the last published thing', async () => {
    const { asAdmin, repositories } = setup()
    const get = await asAdmin()

    await repositories.posts.upsert(defaultContext(), { title: 'Draft', slug: 'draft', status: 'draft' })

    const body = (await (await get('/overview')).json()) as Overview

    expect(body.lastPublished).toBeNull()
  })

  it('counts media, which has no drafts', async () => {
    const { asAdmin, repositories } = setup()
    const get = await asAdmin()

    await repositories.media.insert(defaultContext(), {
      filename: 'a.png',
      storageKey: 'a',
      mimeType: 'image/png',
      byteSize: 10,
    })

    const body = (await (await get('/overview')).json()) as Overview

    expect(body.counts.media).toBe(1)
  })
})
