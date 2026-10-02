import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import type { Env } from '../env'
import { fakeAssets, fakeKv, makeTestEnv, type FakeKv } from '../testing/env'
import { CSRF_HEADER } from '@typeky/api'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'
import { SESSION_COOKIE } from './session'

/** Cheap parameters: scrypt's own cost is measured and tested elsewhere. */
const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

function environment(options: { withPassword?: boolean } = {}): { env: Env; cache: FakeKv } {
  const cache = fakeKv()
  const env = makeTestEnv({
    CACHE: cache.kv,
    ADMIN_USERNAME: 'admin',
    ...(options.withPassword === false ? {} : { ADMIN_PASSWORD_HASH: passwordHash }),
  })
  return { env, cache }
}

async function send(path: string, env: Env, init?: RequestInit): Promise<Response> {
  return createApp().request(new Request(`https://example.com${path}`, init), undefined, env)
}

function login(env: Env, body: unknown = { username: 'admin', password: PASSWORD }): Promise<Response> {
  return send('/api/admin/session', env, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function cookieOf(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
}

interface SignedIn {
  cookie: string
  csrfToken: string
  actorId: string
}

/** Logs in and returns everything a browser client would hold afterwards. */
async function signIn(env: Env): Promise<SignedIn> {
  const response = await login(env)
  const session = (await response.json()) as { actorId: string; csrfToken: string }
  return { cookie: cookieOf(response), csrfToken: session.csrfToken, actorId: session.actorId }
}

describe('login', () => {
  it('accepts the configured credentials', async () => {
    const { env } = environment()

    const response = await login(env)

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toMatchObject({ actorId: 'admin' })
  })

  it('sets a __Host- cookie that JavaScript cannot read', async () => {
    const { env } = environment()

    const header = (await login(env)).headers.get('set-cookie') ?? ''

    expect(header.startsWith(`${SESSION_COOKIE}=`)).toBe(true)
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true)
    expect(header).toContain('HttpOnly')
    expect(header).toContain('Secure')
    expect(header).toContain('SameSite=Lax')
    // A __Host- cookie must be path-wide and host-only.
    expect(header).toContain('Path=/')
    expect(header).not.toContain('Domain=')
  })

  it('stores the session server-side, so the cookie carries no authority', async () => {
    const { env, cache } = environment()

    const cookie = cookieOf(await login(env))
    const id = cookie.slice(SESSION_COOKIE.length + 1)

    expect(cache.entries.has(`session:${id}`)).toBe(true)
  })

  it('rejects a wrong password', async () => {
    const { env } = environment()

    const response = await login(env, { username: 'admin', password: 'wrong' })

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'invalid_credentials' })
  })

  it('rejects a wrong username before it would matter', async () => {
    const { env } = environment()

    const response = await login(env, { username: 'root', password: PASSWORD })

    expect(response.status).toBe(401)
  })

  it('rejects a body that is not a credential pair', async () => {
    const { env } = environment()

    expect((await login(env, { username: 'admin' })).status).toBe(400)
    expect((await login(env, { username: '', password: '' })).status).toBe(400)
    expect(
      (
        await send('/api/admin/session', env, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: 'not json',
        })
      ).status,
    ).toBe(400)
  })

  it('fails closed when no password has been configured', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { env } = environment({ withPassword: false })

    const response = await login(env)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'admin_password_not_configured' })
  })

  it('never sets a session cookie on a failed login', async () => {
    const { env } = environment()

    expect((await login(env, { username: 'admin', password: 'wrong' })).headers.get('set-cookie')).toBeNull()
  })
})

describe('session-protected endpoints', () => {
  it('answers 401 without a session', async () => {
    const { env } = environment()

    const response = await send('/api/admin/pages', env)

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'unauthorized' })
  })

  it('answers 401 for a session id that is not in the store', async () => {
    const { env } = environment()

    const response = await send('/api/admin/pages', env, {
      headers: { cookie: `${SESSION_COOKIE}=made-up` },
    })

    expect(response.status).toBe(401)
  })

  it('lets an authenticated read through to the handler, which answers for the path', async () => {
    const { env } = environment()
    const { cookie } = await signIn(env)

    // A path no resource claims: the guards have run and handed it on, which is
    // what this is about. Naming a real resource here would make the test depend
    // on that resource continuing to return 404.
    const response = await send('/api/admin/nowhere', env, { headers: { cookie } })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })

  it('reports the current session, including its csrf token', async () => {
    const { env } = environment()
    const { cookie, csrfToken } = await signIn(env)

    const response = await send('/api/admin/session', env, { headers: { cookie } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ actorId: 'admin', csrfToken })
  })

  it('answers 401 for the current-session endpoint without a session', async () => {
    const { env } = environment()

    expect((await send('/api/admin/session', env)).status).toBe(401)
  })

  it('checks the session before the token, so an anonymous write is 401 rather than 403', async () => {
    const { env } = environment()

    const response = await send('/api/admin/pages', env, { method: 'POST' })

    expect(response.status).toBe(401)
  })
})

describe('csrf', () => {
  it('hands the client a token when it logs in', async () => {
    const { env } = environment()

    const response = await login(env)

    await expect(response.json()).resolves.toMatchObject({ csrfToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) })
  })

  it('gives each session its own token', async () => {
    const { env } = environment()

    const first = await signIn(env)
    const second = await signIn(env)

    expect(first.csrfToken).not.toBe(second.csrfToken)
  })

  it('rejects a write with no token', async () => {
    const { env } = environment()
    const { cookie } = await signIn(env)

    const response = await send('/api/admin/pages', env, { method: 'POST', headers: { cookie } })

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'csrf_failed' })
  })

  it('rejects a write with the wrong token', async () => {
    const { env } = environment()
    const { cookie } = await signIn(env)

    const response = await send('/api/admin/pages', env, {
      method: 'POST',
      headers: { cookie, [CSRF_HEADER]: 'not-the-token' },
    })

    expect(response.status).toBe(403)
  })

  it('rejects a token that belongs to a different session', async () => {
    const { env } = environment()
    const mine = await signIn(env)
    const other = await signIn(env)

    const response = await send('/api/admin/pages', env, {
      method: 'POST',
      headers: { cookie: mine.cookie, [CSRF_HEADER]: other.csrfToken },
    })

    expect(response.status).toBe(403)
  })

  it('accepts a write carrying the right token', async () => {
    const { env } = environment()
    const { cookie, csrfToken } = await signIn(env)

    const response = await send('/api/admin/nowhere', env, {
      method: 'POST',
      headers: { cookie, [CSRF_HEADER]: csrfToken },
    })

    // Past the guard, into the catch-all.
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })

  it('does not demand a token for a read', async () => {
    const { env } = environment()
    const { cookie } = await signIn(env)

    expect((await send('/api/admin/nowhere', env, { headers: { cookie } })).status).toBe(404)
  })

  it('does not demand a token to log in', async () => {
    const { env } = environment()

    expect((await login(env)).status).toBe(201)
  })
})

describe('logout', () => {
  it('destroys the session and clears the cookie', async () => {
    const { env, cache } = environment()
    const { cookie } = await signIn(env)

    const response = await send('/api/admin/session', env, { method: 'DELETE', headers: { cookie } })

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=;`)

    const id = cookie.slice(SESSION_COOKIE.length + 1)
    expect(cache.entries.has(`session:${id}`)).toBe(false)
    expect((await send('/api/admin/pages', env, { headers: { cookie } })).status).toBe(401)
  })

  it('is idempotent, so a client that lost its cookie can still clear it', async () => {
    const { env } = environment()

    expect((await send('/api/admin/session', env, { method: 'DELETE' })).status).toBe(204)
  })

  it('skips the token check by design, since the worst case is a nuisance sign-out', async () => {
    const { env } = environment()
    const { cookie } = await signIn(env)

    expect((await send('/api/admin/session', env, { method: 'DELETE', headers: { cookie } })).status).toBe(204)
  })

  it('invalidates the token along with the session', async () => {
    const { env } = environment()
    const { cookie, csrfToken } = await signIn(env)
    await send('/api/admin/session', env, { method: 'DELETE', headers: { cookie } })

    const response = await send('/api/admin/pages', env, {
      method: 'POST',
      headers: { cookie, [CSRF_HEADER]: csrfToken },
    })

    expect(response.status).toBe(401)
  })
})

describe('api separation', () => {
  it('keeps the public api prefix out of the admin router', async () => {
    const { env } = environment()

    const response = await send('/api/v1/pages', env)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })
})

describe('admin shell', () => {
  it('still serves the SPA fallback, which is not behind the api guard', async () => {
    const built = { '/admin/index.html': '<!doctype html><div id="root"></div>' }
    const env = makeTestEnv({ ASSETS: fakeAssets(built) })

    const response = await send('/admin/pages/42', env)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('id="root"')
  })
})
