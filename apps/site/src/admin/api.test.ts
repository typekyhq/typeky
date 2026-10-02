import { beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app'
import type { Env } from '../env'
import { fakeAssets, fakeKv, makeTestEnv, type FakeKv } from '../testing/env'
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

/** Logs in and returns the Cookie header a browser would send back. */
async function signIn(env: Env): Promise<string> {
  const response = await login(env)
  return cookieOf(response)
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

  it('lets an authenticated request through to the not-yet-implemented handler', async () => {
    const { env } = environment()

    const response = await send('/api/admin/pages', env, { headers: { cookie: await signIn(env) } })

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })

  it('reports the current session', async () => {
    const { env } = environment()

    const response = await send('/api/admin/session', env, { headers: { cookie: await signIn(env) } })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ actorId: 'admin' })
  })

  it('answers 401 for the current-session endpoint without a session', async () => {
    const { env } = environment()

    expect((await send('/api/admin/session', env)).status).toBe(401)
  })
})

describe('logout', () => {
  it('destroys the session and clears the cookie', async () => {
    const { env, cache } = environment()
    const cookie = await signIn(env)

    const response = await send('/api/admin/session', env, { method: 'DELETE', headers: { cookie } })

    expect(response.status).toBe(204)
    expect(response.headers.get('set-cookie')).toContain(`${SESSION_COOKIE}=;`)

    const id = cookie.slice(SESSION_COOKIE.length + 1)
    expect(cache.entries.has(`session:${id}`)).toBe(false)
    expect((await send('/api/admin/pages', env, { headers: { cookie } })).status).toBe(401)
  })

  it('is harmless without a session', async () => {
    const { env } = environment()

    expect((await send('/api/admin/session', env, { method: 'DELETE' })).status).toBe(204)
  })
})

describe('api separation', () => {
  it('keeps the public api prefix out of the admin router', async () => {
    const { env } = environment()

    const response = await send('/api/v1/pages', env)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'not_found' })
  })

  it('does not require a session to reach the admin login', async () => {
    // Covered by the login tests, asserted here as the reason the middleware is
    // registered after the session routes rather than before them.
    const { env } = environment()

    expect((await login(env)).status).toBe(201)
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
