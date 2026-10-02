import type { Site, SiteRepository } from '@typeky/db'
import { beforeAll, describe, expect, it } from 'vitest'
import type { AdminEnv } from './errors'
import { createAdminApi } from './api'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'
import { fakeKv, makeTestEnv } from '../testing/env'
import { CSRF_HEADER } from '@typeky/api'
import { stubRepositories } from '../testing/repositories'

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

/** A stand-in for the D1-backed repository: the SQL itself is tested in @typeky/db. */
function fakeSiteRepository() {
  let site: Site | null = null

  const repository: SiteRepository = {
    async get() {
      return site
    },
    async save(_ctx, input) {
      const timestamp = new Date('2026-01-01T00:00:00.000Z')
      site = {
        id: 'default',
        name: input.name,
        tagline: input.tagline,
        logoMediaId: input.logoMediaId,
        theme: input.theme,
        settings: input.settings,
        nav: input.nav,
        createdAt: site?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      return site
    },
  }

  return { repository, stored: () => site }
}

function setup(options: { withDatabase?: boolean } = {}) {
  const { repository, stored } = fakeSiteRepository()
  const cache = fakeKv()

  const api = createAdminApi({
    repositories: options.withDatabase === false ? () => null : () => stubRepositories({ sites: repository }),
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
    return { cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '', csrfToken: session.csrfToken }
  }

  return { send, signIn, stored }
}

const DOCUMENT = {
  name: 'Typeky Demo',
  tagline: 'A small site',
  logoMediaId: null,
  theme: 'default',
  settings: { accentColor: '#111827', footer: 'Built with Typeky.' },
  nav: [
    { label: 'Home', href: '/', order: 0 },
    { label: 'Blog', href: '/posts', order: 1 },
  ],
}

describe('reading the site', () => {
  it('needs a session, like everything else', async () => {
    const { send } = setup()

    expect((await send('/site')).status).toBe(401)
  })

  it('says so when the site row does not exist yet', async () => {
    const { send, signIn } = setup()

    const response = await send('/site', undefined, (await signIn()).cookie)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toMatchObject({ error: 'not_found' })
  })

  it('says so when there is no database bound at all', async () => {
    const { send, signIn } = setup({ withDatabase: false })

    const response = await send('/site', undefined, (await signIn()).cookie)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ error: 'database_not_configured' })
  })

  it('returns the document with its timestamps as strings', async () => {
    const { send, signIn } = setup()
    const { cookie, csrfToken } = await signIn()
    await send('/site', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
      body: JSON.stringify(DOCUMENT),
    }, cookie)

    const response = await send('/site', undefined, cookie)
    const body = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(body.name).toBe('Typeky Demo')
    expect(body.updatedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(typeof body.updatedAt).toBe('string')
  })
})

describe('writing the site', () => {
  it('stores what it was given', async () => {
    const { send, signIn, stored } = setup()
    const { cookie, csrfToken } = await signIn()

    const response = await send('/site', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
      body: JSON.stringify(DOCUMENT),
    }, cookie)

    expect(response.status).toBe(200)
    expect(stored()?.settings).toEqual(DOCUMENT.settings)
    expect(stored()?.nav).toEqual(DOCUMENT.nav)
  })

  it('requires the csrf token, like any other write', async () => {
    const { send, signIn, stored } = setup()
    const { cookie } = await signIn()

    const response = await send('/site', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(DOCUMENT),
    }, cookie)

    expect(response.status).toBe(403)
    expect(stored()).toBeNull()
  })

  it('names the offending field instead of returning a bare 400', async () => {
    const { send, signIn } = setup()
    const { cookie, csrfToken } = await signIn()

    const response = await send('/site', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
      body: JSON.stringify({ ...DOCUMENT, nav: [{ label: '', href: '/', order: 0 }] }),
    }, cookie)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'invalid_request',
      message: expect.stringContaining('nav.0.label'),
    })
  })

  it('rejects a body that is not JSON', async () => {
    const { send, signIn } = setup()
    const { cookie, csrfToken } = await signIn()

    const response = await send('/site', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
      body: 'not json',
    }, cookie)

    expect(response.status).toBe(400)
  })

  it('clears a field the caller left out, because the write is a whole document', async () => {
    const { send, signIn, stored } = setup()
    const { cookie, csrfToken } = await signIn()

    await send('/site', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
      body: JSON.stringify(DOCUMENT),
    }, cookie)
    await send('/site', {
      method: 'PUT',
      headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
      body: JSON.stringify({ ...DOCUMENT, tagline: undefined, settings: {} }),
    }, cookie)

    expect(stored()?.tagline).toBeNull()
    expect(stored()?.settings).toEqual({})
  })
})
