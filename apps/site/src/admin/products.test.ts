import { CSRF_HEADER } from '@typeky/api'
import type { Product, ProductRepository, Repositories } from '@typeky/db'
import { beforeAll, describe, expect, it } from 'vitest'
import { fakeKv, makeTestEnv } from '../testing/env'
import { createAdminApi } from './api'
import type { AdminEnv, RepositoryResolver } from './errors'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'

/**
 * The product endpoints.
 *
 * The repository underneath is a Map: the SQL is tested in @typeky/db. What is
 * checked here is that every field a product has survives the round trip -- a
 * gallery or a specification list that a write silently dropped would look fine
 * on the list screen and be empty on the site.
 */

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'
const TIMESTAMP = new Date('2026-03-03T00:00:00.000Z')

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

function fakeProductsRepository() {
  const rows = new Map<string, Product>()
  let sequence = 0

  const repository: ProductRepository = {
    async list(_ctx, query = {}) {
      const limit = query.limit ?? 20
      const offset = query.offset ?? 0
      const search = query.search?.toLowerCase()

      const matches = [...rows.values()].filter(
        (product) =>
          (query.status === undefined || product.status === query.status) &&
          (search === undefined ||
            [product.title, product.slug, product.summary ?? ''].some((field) =>
              field.toLowerCase().includes(search),
            )),
      )

      return { items: matches.slice(offset, offset + limit), total: matches.length, limit, offset }
    },
    async byId(_ctx, id) {
      return rows.get(id) ?? null
    },
    async bySlug(_ctx, slug) {
      return [...rows.values()].find((product) => product.slug === slug) ?? null
    },
    async upsert(_ctx, input) {
      const existing = input.id === undefined ? null : (rows.get(input.id) ?? null)
      const id = existing?.id ?? input.id ?? `product_${String(++sequence)}`
      const status = input.status ?? existing?.status ?? 'draft'

      const product: Product = {
        id,
        title: input.title,
        slug: input.slug,
        summary: input.summary ?? null,
        blocks: input.blocks ?? [],
        coverMediaId: input.coverMediaId ?? null,
        gallery: input.gallery ?? [],
        specs: input.specs ?? [],
        priceLabel: input.priceLabel ?? null,
        ctaLabel: input.ctaLabel ?? null,
        ctaUrl: input.ctaUrl ?? null,
        seo: input.seo ?? {},
        status,
        sortOrder: input.sortOrder ?? existing?.sortOrder ?? 0,
        revision: (existing?.revision ?? 0) + 1,
        publishedAt: status === 'published' ? (existing?.publishedAt ?? TIMESTAMP) : null,
        createdAt: existing?.createdAt ?? TIMESTAMP,
        updatedAt: TIMESTAMP,
      }

      rows.set(id, product)
      return product
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

function setup() {
  const { repository, rows } = fakeProductsRepository()
  const cache = fakeKv()

  const api = createAdminApi({
    repositories: (() => ({ products: repository }) as unknown as Repositories) as RepositoryResolver,
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

  return { send, signIn, write, rows }
}

const WIDGET = {
  title: 'Desk lamp',
  slug: 'desk-lamp',
  summary: 'A lamp for a small desk',
  gallery: ['media_one', 'media_two'],
  specs: [
    { label: 'Height', value: '40 cm' },
    { label: 'Bulb', value: 'E27' },
  ],
  priceLabel: 'From $20',
  ctaLabel: 'Buy now',
  ctaUrl: 'https://example.com/checkout',
  seo: {
    title: 'Desk lamp — a small light for small desks',
    ogImageMediaId: 'media_one',
    canonical: 'https://example.com/desk-lamp',
  },
  sortOrder: 2,
}

describe('the product endpoints', () => {
  it('needs a session', async () => {
    const { send } = setup()

    expect((await send('/products')).status).toBe(401)
  })

  it('round-trips every field a product has', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()

    const created = await write('POST', '/products', WIDGET, auth)

    expect(created.status).toBe(201)
    await expect(created.json()).resolves.toMatchObject(WIDGET)
  })

  it('keeps the gallery and the specs when saving again', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/products', WIDGET, auth)).json()) as { id: string }

    const saved = await write('PUT', `/products/${created.id}`, { ...WIDGET, title: 'Desk lamp v2' }, auth)

    await expect(saved.json()).resolves.toMatchObject({
      title: 'Desk lamp v2',
      gallery: ['media_one', 'media_two'],
      specs: WIDGET.specs,
      priceLabel: 'From $20',
      ctaLabel: 'Buy now',
      ctaUrl: 'https://example.com/checkout',
      seo: WIDGET.seo,
      revision: 2,
    })
  })

  it('carries the gallery across a publish from the list', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/products', WIDGET, auth)).json()) as { id: string }

    const published = await write('POST', `/products/${created.id}/status`, { status: 'published' }, auth)

    await expect(published.json()).resolves.toMatchObject({
      status: 'published',
      gallery: ['media_one', 'media_two'],
      specs: WIDGET.specs,
      ctaUrl: 'https://example.com/checkout',
    })
  })

  it('refuses a slug another product holds, naming it', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()
    await write('POST', '/products', { title: 'Original', slug: 'taken' }, auth)

    const response = await write('POST', '/products', { title: 'Second', slug: 'taken' }, auth)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      error: 'slug_taken',
      message: 'The slug "taken" is already used by "Original".',
    })
  })

  it('refuses a spec row with an empty label or value', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()

    const response = await write(
      'POST',
      '/products',
      { title: 'Widget', slug: 'widget', specs: [{ label: '', value: '40 cm' }] },
      auth,
    )

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
  })

  it('writes empty collections rather than nulls', async () => {
    const { signIn, write } = setup()
    const auth = await signIn()

    const response = await write('POST', '/products', { title: 'Widget', slug: 'widget' }, auth)

    await expect(response.json()).resolves.toMatchObject({
      gallery: [],
      specs: [],
      priceLabel: null,
      ctaLabel: null,
      ctaUrl: null,
      coverMediaId: null,
    })
  })

  it('lists with a search, and answers 404 for an unknown id', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    await write('POST', '/products', WIDGET, auth)
    await write('POST', '/products', { title: 'Chair', slug: 'chair' }, auth)

    const search = await send('/products?search=desk', undefined, auth.cookie)

    expect(((await search.json()) as { total: number }).total).toBe(1)
    expect((await send('/products/ghost', undefined, auth.cookie)).status).toBe(404)
  })

  it('deletes and then reports it gone', async () => {
    const { signIn, write, send } = setup()
    const auth = await signIn()
    const created = (await (await write('POST', '/products', WIDGET, auth)).json()) as { id: string }

    const deleted = await send(
      `/products/${created.id}`,
      { method: 'DELETE', headers: { [CSRF_HEADER]: auth.csrfToken } },
      auth.cookie,
    )

    expect(deleted.status).toBe(204)
    expect((await send(`/products/${created.id}`, undefined, auth.cookie)).status).toBe(404)
  })
})
