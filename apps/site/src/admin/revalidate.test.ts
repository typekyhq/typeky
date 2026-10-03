import { CSRF_HEADER } from '@typeky/api'
import type { Page, Site, SiteRepository } from '@typeky/db'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { fakeKv, makeTestEnv } from '../testing/env'
import { stubRepositories } from '../testing/repositories'
import { createAdminApi } from './api'
import type { AdminEnv } from './errors'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'

/**
 * The rule that a successful write forgets the pages it changed.
 *
 * This has its own file rather than living beside any one resource because it is
 * one rule about every write, and the risk is exactly that a new endpoint is added
 * without it. What is checked is the middleware's contract: it runs after the
 * handler has answered, it is skipped when nothing succeeded, and it is skipped
 * for the two endpoints that store nothing a visitor can be served.
 */

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'

const DOCUMENT = {
  name: 'Typeky Demo',
  tagline: null,
  logoMediaId: null,
  theme: 'default',
  settings: {},
  nav: [],
}

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

/** The one page a site serves, so the purge set is not empty. */
function homePage(): Page {
  const stamp = new Date('2026-01-01T00:00:00.000Z')

  return {
    id: 'p1',
    title: 'Home',
    slug: 'home',
    blocks: [],
    useLayout: true,
    customSource: null,
    seo: {},
    status: 'published',
    isHome: true,
    sortOrder: 0,
    revision: 1,
    publishedAt: stamp,
    createdAt: stamp,
    updatedAt: stamp,
  }
}

/** A stand-in for the D1-backed repository: the SQL is tested in @typeky/db. */
function fakeSiteRepository(): SiteRepository {
  let site: Site | null = null

  return {
    async get() {
      return site
    },
    async save(_ctx, input) {
      const stamp = new Date('2026-01-01T00:00:00.000Z')
      site = {
        id: 'default',
        name: input.name,
        tagline: input.tagline,
        logoMediaId: input.logoMediaId,
        theme: input.theme,
        settings: input.settings,
        nav: input.nav,
        createdAt: site?.createdAt ?? stamp,
        updatedAt: stamp,
      }
      return site
    },
  }
}

/**
 * The Worker's cache, recording what each purge forgot.
 *
 * `delete` is the only member that matters: a purge is a set of deletes, and a
 * cache that was told to forget something it never held is indistinguishable from
 * one that was told nothing at all unless the calls are recorded.
 */
function recordingCache(): { deleted: string[] } {
  const deleted: string[] = []

  vi.stubGlobal('caches', {
    default: {
      async match() {
        return undefined
      },
      async put() {
        return undefined
      },
      async delete(key: string) {
        deleted.push(key)
        return true
      },
    },
  })

  return { deleted }
}

function setup(options: { withDatabase?: boolean } = {}) {
  const cache = fakeKv()
  const pages = homePage()

  const api = createAdminApi({
    repositories:
      options.withDatabase === false
        ? () => null
        : () =>
            stubRepositories({
              sites: fakeSiteRepository(),
              pages: {
                home: async () => pages,
                list: async () => ({ items: [pages], total: 1, limit: 100, offset: 0 }),
              },
            }),
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

  async function put(path: string, body: unknown, auth: { cookie: string; csrfToken: string }) {
    return send(
      path,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: auth.csrfToken },
        body: JSON.stringify(body),
      },
      auth.cookie,
    )
  }

  return { send, signIn, put }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('after a write that succeeded', () => {
  it('forgets the pages the site serves, under the request’s own origin', async () => {
    const { signIn, put } = setup()
    const { deleted } = recordingCache()

    const auth = await signIn()
    // Signing in happened before the recording cache was installed, so nothing
    // from it can be in here.
    expect(await put('/site', DOCUMENT, auth)).toHaveProperty('status', 200)

    // The home page, the two lists, and the pagination pages of each -- every URL
    // the site can serve. The list is not empty, which is what would make this
    // assertion pass for the wrong reason.
    expect(deleted).toContain('https://example.com/')
    expect(deleted).toContain('https://example.com/posts')
    expect(deleted).toContain('https://example.com/products')
  })

  it('forgets a URL that has left the set since the last write', async () => {
    const cache = fakeKv()
    // What the previous purge remembered. A page that was unpublished, renamed or
    // deleted is absent from the set this write recomputes, so this is the only place
    // its URL can come from -- and it is the URL that most needs forgetting.
    await cache.kv.put('revalidate:paths', JSON.stringify(['/gone']))

    const api = createAdminApi({
      repositories: () => stubRepositories({ sites: fakeSiteRepository() }),
    })
    const env: AdminEnv['Bindings'] = makeTestEnv({
      CACHE: cache.kv,
      ADMIN_USERNAME: 'admin',
      ADMIN_PASSWORD_HASH: passwordHash,
    })

    const signIn = await api.request(
      new Request('https://example.com/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: PASSWORD }),
      }),
      undefined,
      env,
    )
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? ''
    const { csrfToken } = (await signIn.json()) as { csrfToken: string }

    const { deleted } = recordingCache()

    await api.request(
      new Request('https://example.com/site', {
        method: 'PUT',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken, cookie },
        body: JSON.stringify(DOCUMENT),
      }),
      undefined,
      env,
    )

    expect(deleted).toContain('https://example.com/gone')
  })

  it('does not wait to be asked, because the operator will not know to', async () => {
    const { signIn, put } = setup()
    const { deleted } = recordingCache()

    const auth = await signIn()
    const response = await put('/site', DOCUMENT, auth)

    // Awaited inside the handler: by the time the save is acknowledged, the entry
    // is gone. A background purge would make "publish, then look" a race.
    expect(response.status).toBe(200)
    expect(deleted.length).toBeGreaterThan(0)
  })
})

describe('when nothing succeeded', () => {
  it('forgets nothing after a request that was refused', async () => {
    const { send } = setup()
    const { deleted } = recordingCache()

    // No session, so the guard answers before any handler runs.
    expect((await send('/site', { method: 'PUT' })).status).toBe(401)
    expect(deleted).toEqual([])
  })

  it('forgets nothing when a write fails validation', async () => {
    const { signIn, put } = setup()
    const { deleted } = recordingCache()

    const auth = await signIn()
    const response = await put('/site', { name: '' }, auth)

    expect(response.status).toBe(400)
    expect(deleted).toEqual([])
  })

  it('forgets nothing when there is no database to ask what the site serves', async () => {
    const { signIn, put } = setup({ withDatabase: false })
    const { deleted } = recordingCache()

    const auth = await signIn()
    await put('/site', DOCUMENT, auth)

    // It cannot ask, so it does not guess: clearing a wildcard is not something
    // the cache underneath can do anyway.
    expect(deleted).toEqual([])
  })
})

describe('the two endpoints that store nothing', () => {
  it('does not forget anything when a session is created', async () => {
    const { signIn } = setup()
    const { deleted } = recordingCache()

    await signIn()

    expect(deleted).toEqual([])
  })

  it('does not forget anything when a template is only previewed', async () => {
    const { send, signIn } = setup()
    const { deleted } = recordingCache()

    const auth = await signIn()
    await send(
      '/theme/preview',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: auth.csrfToken },
        body: JSON.stringify({ path: 'templates/post', source: '<p>{{ content.title }}</p>' }),
      },
      auth.cookie,
    )

    expect(deleted).toEqual([])
  })
})
