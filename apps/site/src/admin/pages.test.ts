import { CSRF_HEADER } from '@typeky/api'
import type { Page, PageRepository, Repositories } from '@typeky/db'
import { beforeAll, describe, expect, it } from 'vitest'
import { fakeKv, makeTestEnv } from '../testing/env'
import { createAdminApi } from './api'
import type { AdminEnv, RepositoryResolver } from './errors'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'
import { stubRepositories } from '../testing/repositories'

/**
 * The page endpoints.
 *
 * The repository underneath is a Map that mirrors the real one's home-page rule:
 * at most one row is the home page. That is what the acceptance criterion is
 * about, and it is also asserted directly against the database in @typeky/db --
 * here what matters is that the endpoint reaches it and reports the result.
 */

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'
const TIMESTAMP = new Date('2026-03-03T00:00:00.000Z')

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

function fakePagesRepository() {
  const rows = new Map<string, Page>()
  let sequence = 0

  const repository: PageRepository = {
    async list(_ctx, query = {}) {
      const limit = query.limit ?? 20
      const offset = query.offset ?? 0
      const search = query.search?.toLowerCase()

      const matches = [...rows.values()].filter(
        (page) =>
          (query.status === undefined || page.status === query.status) &&
          (search === undefined ||
            [page.title, page.slug].some((field) => field.toLowerCase().includes(search))),
      )

      return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset }
    },
    async byId(_ctx, id) {
      return rows.get(id) ?? null
    },
    async bySlug(_ctx, slug) {
      return [...rows.values()].find((page) => page.slug === slug) ?? null
    },
    async home() {
      return [...rows.values()].find((page) => page.isHome) ?? null
    },
    async upsert(_ctx, input) {
      const existing = input.id === undefined ? null : (rows.get(input.id) ?? null)
      const id = existing?.id ?? input.id ?? `page_${String(++sequence)}`
      const status = input.status ?? existing?.status ?? 'draft'

      const page: Page = {
        id,
        title: input.title,
        slug: input.slug,
        blocks: input.blocks ?? [],
        seo: input.seo ?? {},
        status,
        // Never from the write: the flag only moves through setHome.
        isHome: existing?.isHome ?? false,
        sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
        revision: (existing?.revision ?? 0) + 1,
        publishedAt: status === 'published' ? (existing?.publishedAt ?? TIMESTAMP) : null,
        createdAt: existing?.createdAt ?? TIMESTAMP,
        updatedAt: TIMESTAMP,
      }

      rows.set(id, page)
      return page
    },
    async setHome(_ctx, id) {
      const target = rows.get(id)
      if (target === undefined) throw new Error(`page not found: ${id}`)

      for (const [key, page] of rows) rows.set(key, { ...page, isHome: key === id })
      return { ...target, isHome: true }
    },
    async updateMany(_ctx, ids, change) {
      let changed = 0
      for (const id of ids) {
        const existing = rows.get(id)
        if (existing === undefined) continue
        rows.set(id, { ...existing, status: change.status, revision: existing.revision + 1 })
        changed += 1
      }
      return changed
    },
    async removeMany(_ctx, ids) {
      let removed = 0
      for (const id of ids) if (rows.delete(id)) removed += 1
      return removed
    },
    async remove(_ctx, id) {
      return rows.delete(id)
    },
  }

  return { repository, rows }
}

function setup(options: { repositories?: RepositoryResolver } = {}) {
  const { repository, rows } = fakePagesRepository()
  const cache = fakeKv()

  const api = createAdminApi({
    repositories: options.repositories ?? (() => stubRepositories({ pages: repository })),
  })

  const env: AdminEnv['Bindings'] = makeTestEnv({
    CACHE: cache.kv,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: passwordHash,
  })

  async function send(path: string, init?: RequestInit, cookie?: string): Promise<Response> {
    const headers = new Headers(init?.headers)
    if (cookie !== undefined) headers.set('cookie', cookie)
    return api.request(new Request(`https://example.com${path}`, { ...init, headers }), undefined, env)
  }

  async function signIn(): Promise<{ cookie: string; csrfToken: string }> {
    const response = await send('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: PASSWORD }),
    })
    const session = (await response.json()) as { csrfToken: string }
    return {
      cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      csrfToken: session.csrfToken,
    }
  }

  async function write(
    method: 'POST' | 'PUT',
    path: string,
    body: unknown,
    auth: { cookie: string; csrfToken: string },
  ): Promise<Response> {
    return send(
      path,
      {
        method,
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: auth.csrfToken },
        body: JSON.stringify(body),
      },
      auth.cookie,
    )
  }

  /** A POST with no body, which is what the action endpoints take. */
  async function act(
    path: string,
    auth: { cookie: string; csrfToken: string },
  ): Promise<Response> {
    return send(path, { method: 'POST', headers: { [CSRF_HEADER]: auth.csrfToken } }, auth.cookie)
  }

  return { send, signIn, write, act, rows }
}

const ABOUT = { title: 'About', slug: 'about' }

describe('reading pages', () => {
  it('needs a session', async () => {
    const { send } = setup()

    expect((await send('/pages')).status).toBe(401)
  })

  it('lists with a search and a status filter', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    await write('POST', '/pages', { title: 'About the studio', slug: 'about', status: 'published' }, auth)
    await write('POST', '/pages', { title: 'About draft', slug: 'about-draft' }, auth)

    const searched = await send('/pages?search=studio', undefined, auth.cookie)
    const filtered = await send('/pages?status=published', undefined, auth.cookie)

    expect(((await searched.json()) as { total: number }).total).toBe(1)
    expect(((await filtered.json()) as { total: number }).total).toBe(1)
  })

  it('has no home page until one is chosen', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    await write('POST', '/pages', ABOUT, auth)

    const response = await send('/pages', undefined, auth.cookie)
    const body = (await response.json()) as { items: { isHome: boolean }[] }

    expect(body.items[0]?.isHome).toBe(false)
  })
})

describe('writing pages', () => {
  it('creates a page and answers 201', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()

    const response = await write('POST', '/pages', ABOUT, auth)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      title: 'About',
      slug: 'about',
      status: 'draft',
      isHome: false,
      sortOrder: 0,
      revision: 1,
    })
  })

  it('stays a draft when only a status action says otherwise', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/pages', ABOUT, auth)).json()) as { id: string }

    const published = await write('POST', `/pages/${created.id}/status`, { status: 'published' }, auth)

    expect(published.status).toBe(200)
    await expect(published.json()).resolves.toMatchObject({ status: 'published' })
  })

  it('refuses a slug another page holds, naming it', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    await write('POST', '/pages', { title: 'Original', slug: 'taken' }, auth)

    const response = await write('POST', '/pages', { title: 'Second', slug: 'taken' }, auth)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'slug_taken',
      message: 'The slug "taken" is already used by "Original".',
    })
  })

  it('does not mistake a page for a conflict with itself', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/pages', ABOUT, auth)).json()) as { id: string }

    expect((await write('PUT', `/pages/${created.id}`, ABOUT, auth)).status).toBe(200)
  })

  it('answers 404 when the update names a page that is not there', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()

    expect((await write('PUT', '/pages/ghost', ABOUT, auth)).status).toBe(404)
  })
})

describe('choosing the home page', () => {
  it('moves the flag, so exactly one page is home', async () => {
    const { signIn, write, act, rows } = setup()
    const auth = await signIn()
    const first = (await (await write('POST', '/pages', { title: 'First', slug: 'first' }, auth)).json()) as {
      id: string
    }
    const second = (await (await write('POST', '/pages', { title: 'Second', slug: 'second' }, auth)).json()) as {
      id: string
    }

    await act(`/pages/${first.id}/home`, auth)
    const response = await act(`/pages/${second.id}/home`, auth)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ id: second.id, isHome: true })
    expect([...rows.values()].filter((page) => page.isHome).map((page) => page.id)).toEqual([second.id])
  })

  it('answers 404 for a page that is not there', async () => {
    const { signIn, act } = setup()
    const auth = await signIn()

    expect((await act('/pages/ghost/home', auth)).status).toBe(404)
  })

  it('needs the CSRF token, like every other write', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/pages', ABOUT, auth)).json()) as { id: string }

    const response = await send(`/pages/${created.id}/home`, { method: 'POST' }, auth.cookie)

    expect(response.status).toBe(403)
  })
})

describe('deleting pages', () => {
  it('deletes and then reports it gone', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/pages', ABOUT, auth)).json()) as { id: string }

    const deleted = await send(
      `/pages/${created.id}`,
      { method: 'DELETE', headers: { [CSRF_HEADER]: auth.csrfToken } },
      auth.cookie,
    )

    expect(deleted.status).toBe(204)
    expect((await send(`/pages/${created.id}`, undefined, auth.cookie)).status).toBe(404)
  })
})
