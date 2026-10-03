import { edgeCacheFrom, type CachePort } from '@typeky/platform'
import type { Repositories } from '@typeky/db'
import { publishedPaths } from './render/sitemap'

/**
 * Whole-page caching at the edge.
 *
 * The point of this file is one sentence from the slice it belongs to: a cache hit
 * must not query the database. Everything else follows from taking that seriously.
 *
 * The key is the origin and the path, with the query dropped. A page is a function
 * of its URL in this product -- there is no search, no personalisation and no
 * session -- so `?utm_source=` must not create a second copy of the same page, and
 * a cache that filled up with one entry per campaign would be a cache that mostly
 * misses.
 *
 * What is cached is only a 200. A 404 and a 503 are answers about a moment (the
 * slug is not published *yet*, the site is not configured *yet*) and pinning one
 * would mean a later deploy could not correct it without a purge nobody knows to
 * request. A success is different: it is true until something changes, and
 * something changing is exactly what `revalidateSite` is told about.
 */

/**
 * How long the edge may keep a page, and why it is not longer.
 *
 * `max-age=0` is for browsers: a returning visitor revalidates, which costs one
 * request and gets them an edge hit rather than a stale page. `s-maxage` is for
 * the shared cache, and its role is to be the backstop rather than the mechanism:
 * a purge reaches the data centre that received it, and the others hold the old
 * copy until this expires. Five minutes is the honest bound for "the rest of the
 * world catches up".
 */
export const PAGE_CACHE_CONTROL = 'public, max-age=0, s-maxage=300'

/**
 * The origin a page is stored under.
 *
 * In production it is the origin the request arrived on, and it has to be: a site
 * answering on `example.com` and `www.example.com` is two copies of one page, and a
 * purge has to say which one it means.
 *
 * In development it is one fixed origin, for two reasons that belong to the dev
 * setup rather than to a site. The admin panel runs on its own port and proxies the
 * API, so a save arrives carrying the *proxy's* origin rather than the origin being
 * looked at. And `localhost:8787` and `127.0.0.1:8787` are two origins for one
 * machine, so whether a purge lands depends on which spelling somebody typed.
 * Either way the symptom is identical, and it looks exactly like a save that did
 * nothing: the admin list is right and the site is not.
 *
 * The cache is still a cache in development -- it fills, it hits, it is purged --
 * which is the part worth being able to try locally. Answering two hostnames is
 * not, so that is the part left to production.
 *
 * The reserved `.invalid` suffix is deliberate: this must never collide with an
 * origin a real site could have.
 */
export const DEV_CACHE_ORIGIN = 'http://typeky.invalid'

export function pageCacheScope(requestOrigin: string, appEnv: string): string {
  // Only `development` is the exception, rather than "anything that is not
  // production": a test run and a staging deploy are both real enough to want the
  // production rule, and a rule written the other way round would quietly change
  // what every one of them caches.
  return appEnv === 'development' ? DEV_CACHE_ORIGIN : requestOrigin.replace(/\/+$/, '')
}

/** The key a page is stored under: scope and path, no query, no method variation. */
export function pageCacheKey(url: URL, scope: string): string {
  return `${scope}${url.pathname}`
}

export interface PageResult {
  status: number
  html: string
}

export interface ServePageInput {
  url: URL
  cache: CachePort
  /**
   * What `APP_ENV` says. Passed in rather than read here, because this module has no
   * environment -- and because the rule below should be testable without pretending
   * to be a Worker.
   */
  appEnv: string
  /** What renders the page, and the only thing here that touches the database. */
  render: (pathname: string) => Promise<PageResult>
  /**
   * Hands a task to the runtime to finish after the response.
   *
   * Passed in rather than reached for, because the execution context only exists
   * inside a Worker request and this function has to be callable without one.
   */
  background: (task: Promise<unknown>) => void
}

/**
 * A page, from the cache or from the renderer.
 *
 * This is the whole of the caching policy, in one function, because the property
 * the slice is about -- a hit does not query the database -- is only checkable if
 * there is one place where the decision is made. A hit returns before `render` is
 * called at all, which is a stronger statement than "the query count was zero":
 * nothing in the render path ran.
 *
 * The marker header goes on the response and not on the stored copy. A stored
 * `miss` served as a hit would be a measurement that lies, and measuring this is
 * the point.
 */
export async function servePage(input: ServePageInput): Promise<Response> {
  const { url, cache, appEnv, render, background } = input
  const key = pageCacheKey(url, pageCacheScope(url.origin, appEnv))

  const hit = await cache.match(key)
  if (hit !== null) return marked(hit, 'hit')

  const result = await render(url.pathname)
  const response = new Response(result.html, {
    status: result.status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': PAGE_CACHE_CONTROL },
  })

  // Only a success is stored. A 404 and a 503 are answers about a moment -- the
  // slug is not published *yet*, the site is not configured *yet* -- and a stored
  // one would need a purge nobody knows to ask for.
  if (result.status === 200) background(cache.put(key, response.clone()))

  return marked(response, 'miss')
}

function marked(response: Response, outcome: 'hit' | 'miss'): Response {
  // Built rather than mutated. A response that came out of the cache has headers
  // that cannot be changed -- `headers.set` on one throws -- and the difference
  // between a stored response and a fresh one is not something this function
  // should have to know about.
  const headers = new Headers(response.headers)
  headers.set('x-typeky-cache', outcome)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * The cache this runtime offers.
 *
 * Read per request rather than captured at module load, because `caches` is a
 * Worker global and a test that stubs it has to be able to do so after this module
 * has been imported. When there is no cache -- Node, or a runtime without one --
 * the port stores nothing and every request renders, which is correct, only slow.
 */
export function edgeCacheFor(): CachePort {
  return edgeCacheFrom(globalThis as { caches?: Parameters<typeof edgeCacheFrom>[0]['caches'] })
}

/**
 * Forget every page the site serves.
 *
 * The set is the whole site rather than the one document that changed, and that is
 * a conclusion rather than a shortcut. A post is in the header's navigation, in
 * the footer's social links, in the list it belongs to, in that list's pagination,
 * on the home page if the theme puts it there, and in the sitemap. Those are
 * rendered into every page, so the pages that can change when one post changes are
 * all of them -- minus the ones with no header, and there are none.
 *
 * `publishedPaths` is used rather than a stored list, because publishing changes
 * the list: a new post adds a URL and an unpublished one removes it.
 *
 * `origin` is the origin the request arrived on, which is the origin the pages were
 * cached under -- see `pageCacheScope`, which is where a development machine is the
 * exception. A site reachable at two hostnames therefore only has the one that was
 * asked for purged in production; that is a real limitation, and a property of
 * keying by URL rather than of this function.
 */
export async function revalidateSite(
  store: Repositories,
  cache: CachePort,
  origin: string,
  appEnv: string,
): Promise<void> {
  // The same function the page was stored with: a purge that computed its own key
  // would be a purge that misses, and missing silently is the thing this file exists
  // to avoid.
  const base = pageCacheScope(origin, appEnv)
  const paths = await publishedPaths(store)

  await cache.purgeByUrl(paths.map((path) => `${base}${path}`))
}
