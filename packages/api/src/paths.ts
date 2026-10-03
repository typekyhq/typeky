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
 * Not listed, because a slug cannot spell them: `robots.txt`, `sitemap.xml` and `/`
 * itself. The content slug pattern is lowercase words joined by hyphens, and those
 * each contain something it does not allow.
 */
export const PLATFORM_PATHS: readonly string[] = [
  '/admin',
  '/api',
  '/healthz',
  '/media',
  '/posts',
  '/products',
  '/theme',
]

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
