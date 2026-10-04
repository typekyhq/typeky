import { CSRF_HEADER } from '@typeky/api'
import type { MediaItem, MediaRepository, Repositories } from '@typeky/db'
import { createMemoryBlob, type MemoryBlob } from '@typeky/platform/testing'
import { beforeAll, describe, expect, it } from 'vitest'
import { fakeKv, makeTestEnv } from '../testing/env'
import { createAdminApi } from './api'
import type { AdminEnv } from './errors'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'
import { stubRepositories } from '../testing/repositories'

/**
 * The media endpoints.
 *
 * The bucket is the in-memory one, so a test can assert what was stored as well
 * as what was answered -- which is where the interesting cases are: a refused
 * upload must leave nothing behind, and a deleted item must take its object with
 * it rather than leaving an orphan the row no longer points at.
 */

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'
const TIMESTAMP = new Date('2026-03-03T00:00:00.000Z')

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

function fakeMediaRepository() {
  const rows = new Map<string, MediaItem>()
  let usages: Record<string, { total: number; places: { kind: string; count: number }[] }> = {}

  const repository: MediaRepository = {
    async list(_ctx, query = {}) {
      const limit = query.limit ?? 20
      const offset = query.offset ?? 0
      const search = query.search?.toLowerCase()

      const matches = [...rows.values()].filter(
        (item) =>
          search === undefined ||
          item.filename.toLowerCase().includes(search) ||
          (item.altText ?? '').toLowerCase().includes(search),
      )

      return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset }
    },
    async byId(_ctx, id) {
      return rows.get(id) ?? null
    },
    async insert(_ctx, input) {
      const item: MediaItem = {
        id: input.id ?? `media_${String(rows.size + 1)}`,
        filename: input.filename,
        storageKey: input.storageKey,
        mimeType: input.mimeType,
        byteSize: input.byteSize,
        width: input.width ?? null,
        height: input.height ?? null,
        altText: input.altText ?? null,
        createdAt: TIMESTAMP,
      }
      rows.set(item.id, item)
      return item
    },
    async usages(_ctx, id) {
      return (usages[id] ?? { total: 0, places: [] }) as never
    },
    async update(_ctx, id, input) {
      const existing = rows.get(id)
      if (existing === undefined) return null

      const saved = { ...existing, altText: input.altText }
      rows.set(id, saved)
      return saved
    },
    async remove(_ctx, id) {
      return rows.delete(id)
    },
  }

  return {
    repository,
    rows,
    /** What the next usages call will answer. */
    setUsages(id: string, value: { total: number; places: { kind: string; count: number }[] }) {
      usages = { ...usages, [id]: value }
    },
  }
}

function setup() {
  const { repository, rows, setUsages } = fakeMediaRepository()
  const bucket = createMemoryBlob()
  const cache = fakeKv()

  const api = createAdminApi({
    repositories: () => stubRepositories({ media: repository }),
    blobs: () => bucket,
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

  /** An upload: the body is the file, the content type is the file's own. */
  async function upload(
    bytes: Uint8Array,
    options: { type?: string; query?: string; length?: string },
    auth: { cookie: string; csrfToken: string },
  ): Promise<Response> {
    const headers = new Headers({
      'content-type': options.type ?? 'image/png',
      'content-length': options.length ?? String(bytes.byteLength),
      [CSRF_HEADER]: auth.csrfToken,
    })

    return send(`/media${options.query ?? '?filename=photo.png'}`, { method: 'POST', headers, body: bytes }, auth.cookie)
  }

  return { send, signIn, upload, rows, bucket, setUsages }
}

const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

describe('uploading', () => {
  it('needs a session', async () => {
    const { send } = setup()

    const response = await send('/media', { method: 'POST', body: BYTES })

    expect(response.status).toBe(401)
  })

  it('stores the object, records it, and answers with it', async () => {
    const { signIn, upload, bucket, rows } = setup()
    const auth = await signIn()

    const response = await upload(BYTES, { query: '?filename=photo.png&width=800&height=600&alt=A photo' }, auth)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({
      filename: 'photo.png',
      mimeType: 'image/png',
      byteSize: BYTES.byteLength,
      width: 800,
      height: 600,
      altText: 'A photo',
    })

    // The object exists, and the row points at it.
    const stored = [...rows.values()][0]!
    expect(bucket.keys()).toEqual([stored.storageKey])
    expect(stored.storageKey.startsWith('media/')).toBe(true)
  })

  it('keeps the extension when the filename is long, without letting it climb out', async () => {
    const { signIn, upload, send, rows } = setup()
    const auth = await signIn()

    await upload(BYTES, { query: `?filename=${'a'.repeat(300)}.png` }, auth)
    const stored = [...rows.values()][0]!

    expect(stored.storageKey.endsWith('.png')).toBe(true)
    expect(stored.storageKey).not.toContain('..')
    // And the original name survives for display, up to its own limit.
    expect(stored.filename.endsWith('.png')).toBe(true)
    void send
  })

  it('refuses a type it will not serve back', async () => {
    const { signIn, upload, bucket } = setup()
    const auth = await signIn()

    // SVG is an image to a browser and a script host to everyone else, and these
    // bytes come back from the site's own origin.
    const response = await upload(BYTES, { type: 'image/svg+xml' }, auth)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
    expect(bucket.keys()).toEqual([])
  })

  it('refuses an upload that declares no length', async () => {
    const { signIn, upload, bucket } = setup()
    const auth = await signIn()

    const response = await upload(BYTES, { length: '0' }, auth)

    expect(response.status).toBe(400)
    expect(bucket.keys()).toEqual([])
  })

  it('refuses one over the limit before reading the body', async () => {
    const { signIn, upload, bucket } = setup()
    const auth = await signIn()

    const response = await upload(BYTES, { length: String(26 * 1024 * 1024) }, auth)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
    expect(bucket.keys()).toEqual([])
  })

  it('says so when no bucket is bound', async () => {
    const { repository } = fakeMediaRepository()
    const api = createAdminApi({
      repositories: () => stubRepositories({ media: repository }),
      blobs: () => null,
    })
    const cache = fakeKv()
    const env = makeTestEnv({ CACHE: cache.kv, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD_HASH: passwordHash })

    const login = await api.request(
      new Request('https://example.com/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: PASSWORD }),
      }),
      undefined,
      env,
    )
    const { csrfToken } = (await login.json()) as { csrfToken: string }
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? ''

    const response = await api.request(
      new Request('https://example.com/media?filename=x.png', {
        method: 'POST',
        headers: { 'content-type': 'image/png', 'content-length': '4', [CSRF_HEADER]: csrfToken, cookie },
        body: BYTES,
      }),
      undefined,
      env,
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'storage_not_configured' })
  })
})

describe('reading back', () => {
  it('lists what is stored', async () => {
    const { signIn, upload, send } = setup()
    const auth = await signIn()
    await upload(BYTES, {}, auth)

    const response = await send('/media', undefined, auth.cookie)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ total: 1, items: [{ filename: 'photo.png' }] })
  })

  it('serves the bytes, with the type they were stored as', async () => {
    const { signIn, upload, send } = setup()
    const auth = await signIn()
    const created = (await (await upload(BYTES, {}, auth)).json()) as { id: string }

    const response = await send(`/media/${created.id}/content`, undefined, auth.cookie)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BYTES)
  })

  it('reports the object missing rather than serving an empty image', async () => {
    const { signIn, upload, send, bucket } = setup()
    const auth = await signIn()
    const created = (await (await upload(BYTES, {}, auth)).json()) as { id: string }

    // The row survives, the object does not: the two have come apart.
    await bucket.delete(`media/${created.id}/photo.png`)

    expect((await send(`/media/${created.id}/content`, undefined, auth.cookie)).status).toBe(404)
  })

  it('answers 404 for media that is not there', async () => {
    const { signIn, send } = setup()
    const auth = await signIn()

    expect((await send('/media/ghost/content', undefined, auth.cookie)).status).toBe(404)
    expect((await send('/media/ghost/usages', undefined, auth.cookie)).status).toBe(404)
  })
})

describe('editing the alt text', () => {
  it('changes it and answers with the item', async () => {
    const { signIn, upload, send, rows } = setup()
    const auth = await signIn()
    const created = (await (await upload(BYTES, { query: '?filename=photo.png&alt=old' }, auth)).json()) as {
      id: string
    }

    const response = await send(
      `/media/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: auth.csrfToken },
        body: JSON.stringify({ altText: 'a red bicycle' }),
      },
      auth.cookie,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ altText: 'a red bicycle' })
    expect([...rows.values()][0]!.altText).toBe('a red bicycle')
  })

  it('clears it when asked for none', async () => {
    const { signIn, upload, send } = setup()
    const auth = await signIn()
    const created = (await (await upload(BYTES, { query: '?filename=photo.png&alt=old' }, auth)).json()) as {
      id: string
    }

    const response = await send(
      `/media/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: auth.csrfToken },
        body: JSON.stringify({ altText: null }),
      },
      auth.cookie,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ altText: null })
  })

  it('refuses text longer than an upload would keep', async () => {
    const { signIn, upload, send } = setup()
    const auth = await signIn()
    const created = (await (await upload(BYTES, {}, auth)).json()) as { id: string }

    const response = await send(
      `/media/${created.id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: auth.csrfToken },
        body: JSON.stringify({ altText: 'a'.repeat(301) }),
      },
      auth.cookie,
    )

    expect(response.status).toBe(400)
  })

  it('says so when there is nothing with that id', async () => {
    const { signIn, send } = setup()
    const auth = await signIn()

    const response = await send(
      '/media/ghost',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: auth.csrfToken },
        body: JSON.stringify({ altText: 'x' }),
      },
      auth.cookie,
    )

    expect(response.status).toBe(404)
  })

  it('needs a session', async () => {
    const { send } = setup()

    const response = await send('/media/ghost', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ altText: 'x' }),
    })

    expect(response.status).toBe(401)
  })
})

describe('deleting', () => {
  it('removes the row and the object', async () => {
    const { signIn, upload, send, bucket, rows } = setup()
    const auth = await signIn()
    const created = (await (await upload(BYTES, {}, auth)).json()) as { id: string }

    const response = await send(
      `/media/${created.id}`,
      { method: 'DELETE', headers: { [CSRF_HEADER]: auth.csrfToken } },
      auth.cookie,
    )

    expect(response.status).toBe(204)
    expect(rows.size).toBe(0)
    expect(bucket.keys()).toEqual([])
  })

  it('reports what a delete would affect', async () => {
    const { signIn, upload, send, setUsages } = setup()
    const auth = await signIn()
    const created = (await (await upload(BYTES, {}, auth)).json()) as { id: string }
    setUsages(created.id, {
      total: 2,
      places: [
        { kind: 'post', count: 1 },
        { kind: 'product', count: 1 },
      ],
    })

    const response = await send(`/media/${created.id}/usages`, undefined, auth.cookie)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      total: 2,
      places: [
        { kind: 'post', count: 1 },
        { kind: 'product', count: 1 },
      ],
    })
  })
})
