/**
 * The URL space the platform claims for itself.
 *
 * A page's URL is `/<slug>`, so a page slugged `admin` would take the path the panel
 * is served from -- and the operator would have locked themselves out of their own
 * site. There are two halves to preventing that, and the split is the point:
 *
 *   - this list is the platform's own and is not editable. It is a statement about
 *     what the Worker answers before the page renderer is reached, so it changes
 *     when a route is added, not when an operator wants it to;
 *   - whatever the operator adds in the site settings is *also* reserved, because
 *     they know about a URL they are about to need long before it exists.
 *
 * A page slug is a single path segment, so the comparison is by first segment:
 * reserving `/api` also refuses a slug of `api`, and adding `/shop/new` refuses
 * `shop`. That is deliberately coarser than path equality -- a page can never be two
 * segments deep, so the finer rule would only ever reserve less than it means.
 *
 * The list is every path the deployment already answers -- the Worker's own routes,
 * the renderer's list paths, and the asset branches the build creates -- because the
 * point of showing it is to answer "what is already taken" without the operator
 * having to guess. `apps/site/src/app.test.ts` asserts it against the routes the app
 * actually registers, so a route added and not reserved fails the build instead of
 * becoming a page that can take it.
 *
 * Two things are deliberately absent. `/` is the site's own front page rather than
 * the platform's -- a page the operator marked as home is what serves it. And
 * `_headers`, which is a real asset but not a path a slug can spell: the content
 * slug pattern is lowercase words joined by hyphens. `robots.txt` and
 * `sitemap.xml` are the opposite case -- unspellable too, and listed anyway, because
 * an incomplete list is one an operator cannot trust.
 */
export const PLATFORM_PATHS: readonly string[] = [
  '/admin',
  '/api',
  '/category',
  '/healthz',
  '/media',
  '/posts',
  '/products',
  '/robots.txt',
  '/sitemap.xml',
  '/static',
  '/theme',
]

/**
 * What the panel's segment is called until an operator chooses another name.
 *
 * `admin` is guessable, which is the complaint the setting answers -- but it is
 * also the address every existing deployment has bookmarked, so it stays the
 * default and moving it is a decision rather than a surprise.
 */
export const DEFAULT_ADMIN_PATH = 'admin'

/**
 * The shape of the segment the panel may be served from.
 *
 * Lower-case, because a URL segment that differs by case is two URLs and only one
 * of them is the one somebody typed. Three characters at the least: two is not a
 * secret, it is a typo away from a path a scanner already tries.
 */
export const ADMIN_PATH_PATTERN = /^[a-z0-9][a-z0-9-]{2,62}$/

/**
 * Whether a value may be the panel's segment.
 *
 * The platform's own paths are refused -- a panel at `/posts` would shadow the
 * post list -- with one exception: `admin` itself, which is the default. Refusing
 * it would make the default value impossible to write back.
 */
export function isAdminPathSegment(value: string): boolean {
  if (!ADMIN_PATH_PATTERN.test(value)) return false
  if (value === DEFAULT_ADMIN_PATH) return true

  return !PLATFORM_PATHS.some((path) => firstPathSegment(path) === value)
}

/**
 * The first path segment, normalised, or an empty string.
 *
 * Lenient on purpose: a settings textarea is written by a person, and `install`,
 * `/install` and `/install/` all mean the same URL here. Being strict about the
 * input would be strict about something that has no consequence.
 */
export function firstPathSegment(path: string): string {
  const trimmed = path.trim().replace(/^\/+/, '')
  return (trimmed.split('/')[0] ?? '').trim().toLowerCase()
}

/**
 * The reserved path a page slug would collide with, or null when there is none.
 *
 * Returns the path rather than a boolean so the refusal can name what it collided
 * with -- "reserved" without saying by what leaves the operator guessing which of
 * their own rules they hit.
 */
export function reservedPathFor(slug: string, extra: readonly string[]): string | null {
  const candidate = firstPathSegment(slug)
  if (candidate === '') return null

  for (const path of [...PLATFORM_PATHS, ...extra]) {
    if (firstPathSegment(path) === candidate) return path
  }

  return null
}
