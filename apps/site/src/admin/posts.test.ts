import { CSRF_HEADER } from '@typeky/api'
import type { Post, PostRepository } from '@typeky/db'
import { beforeAll, describe, expect, it } from 'vitest'
import { fakeKv, makeTestEnv } from '../testing/env'
import { createAdminApi } from './api'
import type { AdminEnv, RepositoryResolver } from './errors'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'

/**
 * The post endpoints.
 *
 * The repository underneath is a Map rather than D1: the SQL is tested in
 * @typeky/db, and what matters here is the layer above it -- which fields reach
 * the wire, which filters reach the repository, and what an operator is told
 * when a slug is already taken.
 */

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'
const TIMESTAMP = new Date('2026-03-03T00:00:00.000Z')

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

function fakePostsRepository() {
  const rows = new Map<string, Post>()
  let sequence = 0

  const repository: PostRepository = {
    async list(_ctx, query = {}) {
      const limit = query.limit ?? 20
      const offset = query.offset ?? 0
      const search = query.search?.toLowerCase()

      const matches = [...rows.values()].filter(
        (post) =>
          (query.status === undefined || post.status === query.status) &&
          (query.category === undefined || post.category === query.category) &&
          (search === undefined ||
            [post.title, post.slug, post.excerpt ?? ''].some((field) =>
              field.toLowerCase().includes(search),
            )),
      )

      return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset }
    },
    async byId(_ctx, id) {
      return rows.get(id) ?? null
    },
    async bySlug(_ctx, slug) {
      return [...rows.values()].find((post) => post.slug === slug) ?? null
    },
    async upsert(_ctx, input) {
      const existing = input.id === undefined ? null : (rows.get(input.id) ?? null)
      const id = existing?.id ?? input.id ?? `post_${String(++sequence)}`
      const status = input.status ?? existing?.status ?? 'draft'

      const post: Post = {
        id,
        title: input.title,
        slug: input.slug,
        excerpt: input.excerpt ?? null,
        coverMediaId: input.coverMediaId ?? null,
        blocks: input.blocks ?? [],
        tags: input.tags ?? [],
        category: input.category ?? null,
        seo: input.seo ?? {},
        status,
        revision: (existing?.revision ?? 0) + 1,
        publishedAt: status === 'published' ? (existing?.publishedAt ?? TIMESTAMP) : null,
        createdAt: existing?.createdAt ?? TIMESTAMP,
        updatedAt: TIMESTAMP,
      }

      rows.set(id, post)
      return post
    },
    async remove(_ctx, id) {
      return rows.delete(id)
    },
  }

  return { repository, rows }
}

function setup(options: { repositories?: RepositoryResolver } = {}) {
  const { repository, rows } = fakePostsRepository()
  const cache = fakeKv()

  const api = createAdminApi({
    repositories: options.repositories ?? (() => ({ posts: repository }) as never),
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

  /** A write, carrying the token the session issued. */
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

  return { send, signIn, write, rows, repository }
}

const DRAFT = { title: 'Hello', slug: 'hello' }

describe('reading posts', () => {
  it('needs a session, like everything else', async () => {
    const { send } = setup()

    expect((await send('/posts')).status).toBe(401)
  })

  it('lists posts without their bodies', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    await write('POST', '/posts', { ...DRAFT, blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }] }, auth)

    const response = await send('/posts', undefined, auth.cookie)
    const body = (await response.json()) as { items: Record<string, unknown>[]; total: number }

    expect(response.status).toBe(200)
    expect(body.total).toBe(1)
    expect(body.items[0]).toMatchObject({ title: 'Hello', slug: 'hello', status: 'draft' })
    // A body is Block JSON, and a list of twenty of them is a megabyte of JSON
    // for a screen that shows titles.
    expect(body.items[0]).not.toHaveProperty('blocks')
  })

  it('passes the status filter and the search term to the repository', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    await write('POST', '/posts', { title: 'Release notes', slug: 'release-notes', status: 'published' }, auth)
    await write('POST', '/posts', { title: 'Release plan', slug: 'release-plan' }, auth)
    await write('POST', '/posts', { title: 'Something else', slug: 'something-else', status: 'published' }, auth)

    const filtered = await send('/posts?status=published', undefined, auth.cookie)
    const searched = await send('/posts?search=release&status=published', undefined, auth.cookie)

    expect(((await filtered.json()) as { total: number }).total).toBe(2)
    expect(((await searched.json()) as { total: number }).total).toBe(1)
  })

  it('refuses a status it cannot render rather than ignoring it', async () => {
    const { signIn, send } = setup()
    const auth = await signIn()

    const response = await send('/posts?status=archived', undefined, auth.cookie)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
  })

  it('says so when there is no post with that id', async () => {
    const { signIn, send } = setup()
    const auth = await signIn()

    expect((await send('/posts/nope', undefined, auth.cookie)).status).toBe(404)
  })
})

describe('writing posts', () => {
  it('creates a post and answers 201', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()

    const response = await write('POST', '/posts', DRAFT, auth)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      title: 'Hello',
      slug: 'hello',
      status: 'draft',
      revision: 1,
      publishedAt: null,
    })
  })

  it('refuses a body the contract cannot store, naming the field', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()

    const response = await write('POST', '/posts', { title: 'Hello', slug: 'Not A Slug' }, auth)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
  })

  it('replaces the post named in the path, keeping its own slug', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/posts', DRAFT, auth)).json()) as { id: string }

    const response = await write('PUT', `/posts/${created.id}`, { ...DRAFT, title: 'Hello again' }, auth)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ title: 'Hello again', revision: 2 })
    expect(((await (await send('/posts', undefined, auth.cookie)).json()) as { total: number }).total).toBe(1)
  })

  it('says which post already holds the slug', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    await write('POST', '/posts', { title: 'Original', slug: 'taken' }, auth)

    const response = await write('POST', '/posts', { title: 'Second', slug: 'taken' }, auth)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'slug_taken',
      message: 'The slug "taken" is already used by "Original".',
    })
  })

  it('does not mistake a post for a conflict with itself', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/posts', DRAFT, auth)).json()) as { id: string }

    // Saving an unchanged post must not report its own slug as taken.
    expect((await write('PUT', `/posts/${created.id}`, DRAFT, auth)).status).toBe(200)
  })

  it('answers 404 when the update names a post that is not there', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()

    expect((await write('PUT', '/posts/ghost', DRAFT, auth)).status).toBe(404)
  })

  it('turns a lost race into the same answer as the check', async () => {
    // Two operators saving the same slug at once both pass the check, and the
    // unique index is what actually decides. That must not surface as a 500.
    const racer: RepositoryResolver = () => ({
      posts: {
        async bySlug() {
          return null
        },
        async upsert() {
          throw new Error('D1_ERROR: UNIQUE constraint failed: posts.slug')
        },
      },
    }) as never

    const { signIn, write } = setup({ repositories: racer })
    const auth = await signIn()

    const response = await write('POST', '/posts', DRAFT, auth)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ error: 'slug_taken' })
  })

  it('needs the CSRF token, like every other write', async () => {
    const { signIn, send } = setup()
    const auth = await signIn()

    const response = await send(
      '/posts',
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(DRAFT) },
      auth.cookie,
    )

    expect(response.status).toBe(403)
  })
})

describe('publishing from the list', () => {
  it('publishes without sending the whole body', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/posts', DRAFT, auth)).json()) as { id: string }

    const response = await write('POST', `/posts/${created.id}/status`, { status: 'published' }, auth)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ status: 'published' })
  })

  it('carries everything else across unchanged', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    const created = (await (
      await write(
        'POST',
        '/posts',
        { ...DRAFT, excerpt: 'Kept', tags: ['one'], category: 'News', blocks: [{ type: 'divider' }] },
        auth,
      )
    ).json()) as { id: string }

    const published = (await (
      await write('POST', `/posts/${created.id}/status`, { status: 'published' }, auth)
    ).json()) as Record<string, unknown>

    expect(published).toMatchObject({
      status: 'published',
      excerpt: 'Kept',
      tags: ['one'],
      category: 'News',
      blocks: [{ type: 'divider' }],
      revision: 2,
    })
    expect(published.publishedAt).not.toBeNull()
  })

  it('refuses a status it cannot render', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/posts', DRAFT, auth)).json()) as { id: string }

    expect((await write('POST', `/posts/${created.id}/status`, { status: 'archived' }, auth)).status).toBe(400)
  })

  it('answers 404 for a post that is not there', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()

    expect((await write('POST', '/posts/ghost/status', { status: 'published' }, auth)).status).toBe(404)
  })
})

describe('deleting posts', () => {
  it('deletes and then reports it gone', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/posts', DRAFT, auth)).json()) as { id: string }

    const deleted = await send(
      `/posts/${created.id}`,
      { method: 'DELETE', headers: { [CSRF_HEADER]: auth.csrfToken } },
      auth.cookie,
    )

    expect(deleted.status).toBe(204)
    expect((await send(`/posts/${created.id}`, undefined, auth.cookie)).status).toBe(404)
  })

  it('answers 404 when there was nothing to delete', async () => {
    const { signIn, send } = setup()
    const auth = await signIn()

    const response = await send(
      '/posts/ghost',
      { method: 'DELETE', headers: { [CSRF_HEADER]: auth.csrfToken } },
      auth.cookie,
    )

    expect(response.status).toBe(404)
  })
})
