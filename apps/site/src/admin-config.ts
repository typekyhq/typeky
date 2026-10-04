import { DEFAULT_ADMIN_PATH, isAdminPathSegment } from '@typeky/api'
import { defaultContext } from '@typeky/db'
import type { Env } from './env'
import { repositoriesFor } from './repositories'

/**
 * Where the panel lives, and the one read in front of the answer.
 *
 * A fixed `/admin` is the first thing a scanner tries, so the operator can move it.
 * The value is stored in the site settings, which means the route table cannot know
 * it -- Hono registers routes once, when the isolate starts, and `env` is not even
 * available then. So the panel's segment is not a route: it is decided per request,
 * and that decision is what this module makes.
 *
 * Deciding per request could mean reading the site row per request, which would put
 * a database read in front of every page of the site. It does not: the answer is
 * kept for `CACHE_TTL_MS`, so an isolate asks the database at most once a minute and
 * every other request is a variable lookup.
 *
 * The trade that buys is time, and it is worth stating plainly: a change to the path
 * takes effect within the TTL rather than instantly, across isolates. The saving
 * isolate forgets its answer immediately (`forgetAdminPath`), so the operator's own
 * next request already sees the new address; another isolate may answer with the old
 * one for up to the TTL. Both work, which is what makes the change safe rather than a
 * way to lock yourself out.
 */
/**
 * The directory the panel's own files are built into.
 *
 * It stays `/admin` whatever the entry point is called: it is a build constant, and
 * hiding the *files* would hide nothing -- the source is public -- while costing a
 * rebuild and a second dev-server path. What is secret is the way in, not the code.
 */
export const ADMIN_BUILD_SEGMENT = 'admin'

const CACHE_TTL_MS = 30_000

let cached: { value: string; expiresAt: number } | null = null

/**
 * The configured segment, or the default.
 *
 * Read without trusting the shape: a row written by hand, or by a version that
 * stored something else, must leave the panel reachable rather than make every
 * request a 404.
 */
export function adminPathOf(settings: object | null | undefined): string {
  if (settings === null || settings === undefined) return DEFAULT_ADMIN_PATH

  const admin = (settings as Record<string, unknown>).admin
  if (typeof admin !== 'object' || admin === null) return DEFAULT_ADMIN_PATH

  const path = (admin as Record<string, unknown>).path
  return typeof path === 'string' && isAdminPathSegment(path) ? path : DEFAULT_ADMIN_PATH
}

/** The segment this deployment serves the panel from. */
export async function adminPathFor(env: Env): Promise<string> {
  const now = Date.now()
  if (cached !== null && cached.expiresAt > now) return cached.value

  const store = repositoriesFor(env)
  // A database that cannot be reached leaves the panel at its default rather than
  // breaking the site: the gateway asks this for every request, and an error here
  // must not become one there.
  const site = store === null ? null : await store.sites.get(defaultContext()).catch(() => null)

  cached = { value: adminPathOf(site?.settings), expiresAt: now + CACHE_TTL_MS }

  return cached.value
}

/**
 * Drops the cached answer, which is what a settings save does.
 *
 * Called from the isolate that handled the save, so the operator's next request
 * already sees the address they just chose.
 */
export function forgetAdminPath(): void {
  cached = null
}

/**
 * Forgets the cached answer for tests.
 *
 * The cache is per isolate, and a test process is one isolate running many cases:
 * without this, a case that sets a path would decide the answer for the next one.
 * `makeTestEnv` calls it, so a test cannot forget to.
 */
export function resetAdminPathCache(): void {
  cached = null
}
