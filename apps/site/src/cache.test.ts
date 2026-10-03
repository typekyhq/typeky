import type { Page, Post } from '@typeky/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEV_CACHE_ORIGIN,
  edgeCacheFor,
  PAGE_CACHE_CONTROL,
  pageCacheKey,
  pageCacheScope,
  revalidateSite,
  servePage,
} from './cache'
import { fakeCache } from './testing/cache'
import { stubRepositories } from './testing/repositories'

/**
 * The caching policy.
 *
 * The acceptance for this slice is "a cache hit does not query the database", and
 * the way that is checked here is stronger than counting queries: the renderer is
 * not called at all, and the renderer is the only thing in the path that opens the
 * database. `P95 < 200 ms` on a hit is measured against a running Worker, because
 * a unit test's clock says nothing about a network.
 */

const NO_BACKGROUND = () => undefined

async function request(
  path: string,
  render: () => Promise<{ status: number; html: string }>,
  cache = fakeCache(),
  appEnv = 'production',
) {
  const url = new URL(`https://example.com${path}`)
  const response = await servePage({ url, cache, appEnv, render, background: NO_BACKGROUND })

  return { response, cache, html: async () => response.text() }
}

describe('the cache key', () => {
  it('is the origin and the path, so a campaign parameter is not a second page', () => {
    const url = new URL('https://example.com/posts/hello?utm_source=x')

    expect(pageCacheKey(url, pageCacheScope(url.origin, 'production'))).toBe(
      'https://example.com/posts/hello',
    )
  })

  it('keeps the host in production, because two hosts are two sites', () => {
    const a = new URL('https://a.example/posts')
    const b = new URL('https://b.example/posts')

    expect(pageCacheKey(a, pageCacheScope(a.origin, 'production'))).not.toBe(
      pageCacheKey(b, pageCacheScope(b.origin, 'production')),
    )
  })

  it('drops the host in development, where there is one site on one machine', () => {
    const localhost = new URL('http://localhost:8787/posts')
    const loopback = new URL('http://127.0.0.1:8787/posts')

    // Two spellings of one machine. Keyed by origin they are two copies of one page,
    // and whether a purge lands depends on which one somebody typed -- which is
    // exactly how a save comes to look like it did nothing.
    expect(pageCacheScope(localhost.origin, 'development')).toBe(DEV_CACHE_ORIGIN)
    expect(pageCacheKey(localhost, pageCacheScope(localhost.origin, 'development'))).toBe(
      pageCacheKey(loopback, pageCacheScope(loopback.origin, 'development')),
    )
  })

  it('uses the production rule for anything that is not development', () => {
    // A test run and a staging deploy are both real enough to want the rule that
    // answers two hostnames correctly.
    expect(pageCacheScope('https://example.com', 'test')).toBe('https://example.com')
    expect(pageCacheScope('https://example.com', 'staging')).toBe('https://example.com')
  })
})

describe('serving a page', () => {
  it('renders once and serves the stored copy after that', async () => {
    const cache = fakeCache()
    let renders = 0
    const render = async () => {
      renders += 1
      return { status: 200, html: '<p>Hello</p>' }
    }

    const first = await request('/posts/hello', render, cache)
    const second = await request('/posts/hello', render, cache)

    expect(first.response.headers.get('x-typeky-cache')).toBe('miss')
    expect(second.response.headers.get('x-typeky-cache')).toBe('hit')
    // The assertion the slice is about: on a hit nothing that could reach the
    // database ran.
    expect(renders).toBe(1)
    await expect(second.html()).resolves.toBe('<p>Hello</p>')
  })

  it('marks a hit without touching the stored response', async () => {
    // The runtime hands back a cached response with immutable headers, so the
    // marker has to go on a new response rather than onto that one. This test
    // exists because the first version mutated it and every hit was a 500.
    const cache = fakeCache()
    const render = async () => ({ status: 200, html: '<p>Hello</p>' })

    await request('/posts/hello', render, cache)
    const second = await request('/posts/hello', render, cache)

    expect(second.response.status).toBe(200)
    expect(second.response.headers.get('x-typeky-cache')).toBe('hit')
    await expect(second.html()).resolves.toBe('<p>Hello</p>')
  })

  it('does not store a marker in the copy it stores', async () => {
    // A stored `miss` served as a hit would be a measurement that lies, and the
    // measurement is the point.
    const { cache } = await request('/posts/hello', async () => ({ status: 200, html: '<p>Hi</p>' }))

    expect(cache.entries.get('https://example.com/posts/hello')?.headers.get('x-typeky-cache')).toBeNull()
  })

  it('does not store a 404, because "not yet published" is not permanent', async () => {
    const cache = fakeCache()
    const notFound = async () => ({ status: 404, html: '<p>No</p>' })

    const first = await request('/nope', notFound, cache)
    const second = await request('/nope', notFound, cache)

    expect(first.response.headers.get('x-typeky-cache')).toBe('miss')
    expect(second.response.headers.get('x-typeky-cache')).toBe('miss')
    expect(cache.entries.size).toBe(0)
  })

  it('does not store the 503 for a site that has not been set up', async () => {
    // Publishing anything has to be able to replace this answer, and nothing
    // purges a URL that was never published.
    const cache = fakeCache()

    await request('/about', async () => ({ status: 503, html: 'no database' }), cache)

    expect(cache.entries.size).toBe(0)
  })

  it('tells a browser to revalidate but lets the shared cache hold the page', async () => {
    const { response } = await request('/posts/hello', async () => ({ status: 200, html: 'x' }))

    expect(response.headers.get('cache-control')).toBe(PAGE_CACHE_CONTROL)
    // A browser holding a page cannot be purged, so it must ask again; the edge
    // can be purged, so it may hold one.
    expect(PAGE_CACHE_CONTROL).toContain('max-age=0')
    expect(PAGE_CACHE_CONTROL).toContain('s-maxage=')
  })
})

describe('revalidating', () => {
  const home = {
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
    publishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as Page

  const post = {
    id: 'x1',
    title: 'Hello',
    slug: 'hello',
    blocks: [],
    tags: [],
    seo: {},
    status: 'published',
    revision: 1,
    publishedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } as unknown as Post

  function store() {
    return stubRepositories({
      pages: {
        home: async () => home,
        list: async () => ({ items: [home], total: 1, limit: 100, offset: 0 }),
      },
      posts: {
        list: async () => ({ items: [post], total: 1, limit: 100, offset: 0 }),
      },
    })
  }

  it('forgets every URL the site serves, under the origin it was cached with', async () => {
    const cache = fakeCache()

    await revalidateSite(store(), cache, 'https://example.com', 'production')

    expect(cache.purges).toContain('https://example.com/')
    expect(cache.purges).toContain('https://example.com/posts')
    expect(cache.purges).toContain('https://example.com/posts/hello')
    expect(cache.purges).toContain('https://example.com/products')
  })

  it('tolerates a trailing slash on the origin instead of double-slashed keys', async () => {
    const cache = fakeCache()

    await revalidateSite(store(), cache, 'https://example.com/', 'production')

    expect(cache.purges).toContain('https://example.com/posts')
    expect(cache.purges.some((key) => key.includes('//posts'))).toBe(false)
  })

  it('reaches a page in development whichever spelling stored it', async () => {
    const cache = fakeCache()

    // Opened the way a person opens it...
    await servePage({
      url: new URL('http://localhost:8787/'),
      cache,
      appEnv: 'development',
      render: async () => ({ status: 200, html: '<h1>Home</h1>' }),
      background: NO_BACKGROUND,
    })
    // ...and saved through the admin, whose request arrives carrying the origin the
    // dev proxy rewrote the Host to. Two origins, one machine, one page.
    await revalidateSite(store(), cache, 'http://127.0.0.1:8787', 'development')

    expect(cache.entries.size).toBe(0)
  })

  it('leaves the other host alone in production, which is the documented limit', async () => {
    const cache = fakeCache()

    // Served at one hostname...
    await servePage({
      url: new URL('https://www.example.com/'),
      cache,
      appEnv: 'production',
      render: async () => ({ status: 200, html: '<h1>Home</h1>' }),
      background: NO_BACKGROUND,
    })
    // ...and saved while the admin was open at the other. The apex keeps the old
    // copy until `s-maxage` expires, which is a real limitation of keying by URL
    // rather than something a dev-machine exception should quietly hide.
    await revalidateSite(store(), cache, 'https://example.com', 'production')

    expect(cache.entries.has('https://www.example.com/')).toBe(true)
  })

  it('forgets a URL that has left the set, which recomputing cannot find', async () => {
    const cache = fakeCache()
    cache.entries.set('https://example.com/about', new Response('<p>old</p>'))

    // `/about` is gone from the set the site serves now -- unpublished, renamed or
    // deleted -- and that is exactly the URL a recomputation cannot name. It is also
    // the one that must not be served: the cached 200 would outlive the row.
    await revalidateSite(store(), cache, 'https://example.com', 'production', [
      '/',
      '/about',
      '/posts',
    ])

    expect(cache.entries.has('https://example.com/about')).toBe(false)
  })

  it('answers with the set in force, for the next purge to be given back', async () => {
    const cache = fakeCache()

    const paths = await revalidateSite(store(), cache, 'https://example.com', 'production')

    // The caller stores this and hands it back next time; without it, the URL a write
    // removes would be the one URL nobody can name.
    expect(paths).toContain('/posts/hello')
    expect(paths).toContain('/')
  })

  it('takes the pages out of the cache rather than only noting them', async () => {
    const cache = fakeCache()
    cache.entries.set('https://example.com/posts/hello', new Response('<p>old</p>'))

    await revalidateSite(store(), cache, 'https://example.com', 'production')

    expect(cache.entries.has('https://example.com/posts/hello')).toBe(false)
  })
})

describe('finding the runtime cache', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('stores nothing when the runtime has no cache', async () => {
    // Which is Node, where these tests run -- and the honest answer for any
    // runtime that offers none: every request renders.
    expect(edgeCacheFor()).toBeDefined()
    await expect(edgeCacheFor().match('anything')).resolves.toBeNull()
  })

  it('uses the global the runtime provides', async () => {
    const stored = new Map<string, Response>()
    vi.stubGlobal('caches', {
      default: {
        async match(key: string) {
          return stored.get(key)
        },
        async put(key: string, response: Response) {
          stored.set(key, response)
        },
        async delete(key: string) {
          return stored.delete(key)
        },
      },
    })

    const cache = edgeCacheFor()
    await cache.put('https://example.com/', new Response('page'))
    await expect(cache.match('https://example.com/')).resolves.toBeInstanceOf(Response)

    await cache.purgeByUrl(['https://example.com/'])
    await expect(cache.match('https://example.com/')).resolves.toBeNull()
  })
})
