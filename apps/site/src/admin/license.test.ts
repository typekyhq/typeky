import { CSRF_HEADER } from '@typeky/api'
import { beforeAll, describe, expect, it } from 'vitest'
import { fakeKv, makeTestEnv } from '../testing/env'
import { stubRepositories } from '../testing/repositories'
import { createAdminApi } from './api'
import type { AdminEnv } from './errors'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'

/**
 * The licence endpoint.
 *
 * What it is for is making a licence that does not apply diagnosable from inside
 * the product, so what is checked here is mostly the shape of a refusal: the
 * domain that was checked, the domain the licence names, and the fact that the
 * answer is a 200 rather than an error. A licence problem is not a broken
 * deployment.
 */

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

function setup(options: { licenseKey?: string } = {}) {
  const cache = fakeKv()
  const api = createAdminApi({ repositories: () => stubRepositories({}) })

  const env: AdminEnv['Bindings'] = makeTestEnv({
    CACHE: cache.kv,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: passwordHash,
    ...(options.licenseKey === undefined ? {} : { LICENSE_KEY: options.licenseKey }),
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

  async function read(cookie: string): Promise<Record<string, unknown>> {
    return (await (await send('/license', undefined, cookie)).json()) as Record<string, unknown>
  }

  return { send, signIn, read }
}

describe('the licence endpoint', () => {
  it('needs a session, like everything else', async () => {
    const { send } = setup()

    expect((await send('/license')).status).toBe(401)
  })

  it('reports a free deployment as free, with no problem attached', async () => {
    const { signIn, read } = setup()

    const { cookie } = await signIn()

    // No `problem`: not having bought a licence is the ordinary state, not a
    // fault, and reporting it as one would train the operator to ignore it.
    expect(await read(cookie)).toEqual({ whiteLabel: false, domain: 'example.com' })
  })

  it('names the domain it checked, so a refusal can be read', async () => {
    const { signIn, read } = setup()

    const { cookie } = await signIn()
    const body = await read(cookie)

    // The request's own host, which in production is the site's domain.
    expect(body['domain']).toBe('example.com')
  })

  it('answers a key it cannot verify without failing the request', async () => {
    const { signIn, read } = setup({ licenseKey: 'not-a-licence' })

    const { cookie } = await signIn()
    const body = await read(cookie)

    expect(body['whiteLabel']).toBe(false)
    expect(body['problem']).toBe('malformed')
  })

  it('never echoes the key back', async () => {
    const key = 'not-a-licence'
    const { signIn, read } = setup({ licenseKey: key })

    const { cookie } = await signIn()

    // Anything that renders JSON is one careless console.log away from a log full
    // of secrets, so the key stays on the server.
    expect(JSON.stringify(await read(cookie))).not.toContain(key)
  })

  it('is a read, so it needs no CSRF token', async () => {
    const { signIn, send } = setup()

    const { cookie, csrfToken } = await signIn()
    // A GET with no token at all: a read has nothing to forge.
    expect((await send('/license', undefined, cookie)).status).toBe(200)
    void csrfToken
    void CSRF_HEADER
  })
})
