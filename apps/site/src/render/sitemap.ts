import { defaultContext, MAX_PAGE_LIMIT, type Repositories } from '@typeky/db'

/**
 * `sitemap.xml` and `robots.txt`.
 *
 * Both are generated rather than stored, because both are statements about what
 * the site currently contains. A stored sitemap is a sitemap that goes stale the
 * first time somebody publishes.
 *
 * Only published content appears. A draft is not a page a crawler should be told
 * about, and listing one would be asking to have it indexed.
 */

/** Escaped for XML. The same five characters as HTML, which is not an accident. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function isPublished(row: { status?: string }): boolean {
  return row.status === undefined || row.status === 'published'
}

interface Entry {
  path: string
  lastModified: Date
}

/**
 * Every published page, post and product, plus the lists.
 *
 * Paged through rather than asked for in one go: the repository caps a window,
 * and a sitemap that silently stopped at the cap would be worse than one that
 * took a few queries to build.
 */
async function collectEntries(store: Repositories): Promise<Entry[]> {
  const ctx = defaultContext()
  const entries: Entry[] = [{ path: '/', lastModified: new Date() }]

  const home = await store.pages.home(ctx)
  if (home !== null && home.status === 'published') {
    entries[0] = { path: '/', lastModified: home.updatedAt }
  }

  const lists: {
    path: string
    load: (
      offset: number,
    ) => Promise<{ items: { slug: string; updatedAt: Date; status?: string }[]; total: number }>
  }[] = [
    {
      path: '/posts',
      load: (offset) => store.posts.list(ctx, { status: 'published', limit: MAX_PAGE_LIMIT, offset }),
    },
    {
      path: '/products',
      load: (offset) => store.products.list(ctx, { status: 'published', limit: MAX_PAGE_LIMIT, offset }),
    },
  ]

  for (const list of lists) {
    entries.push({ path: list.path, lastModified: new Date() })

    const prefix = list.path
    let offset = 0
    let total = Number.POSITIVE_INFINITY

    while (offset < total) {
      const page = await list.load(offset)
      total = page.total
      if (page.items.length === 0) break

      for (const item of page.items) {
        // The repository was asked for published rows and this checks again: a
        // sitemap that listed a draft would be asking to have it indexed.
        if (!isPublished(item)) continue
        entries.push({ path: `${prefix}/${item.slug}`, lastModified: item.updatedAt })
      }

      offset += page.items.length
    }
  }

  // Pages after the lists, because a page whose slug is `posts` cannot exist --
  // the resolver would have made it the list -- and ordering them this way keeps
  // that visible.
  let pageOffset = 0
  let pageTotal = Number.POSITIVE_INFINITY

  while (pageOffset < pageTotal) {
    const listing = await store.pages.list(ctx, { status: 'published', limit: MAX_PAGE_LIMIT, offset: pageOffset })
    pageTotal = listing.total
    if (listing.items.length === 0) break

    for (const page of listing.items) {
      if (page.isHome || !isPublished(page)) continue
      entries.push({ path: `/${page.slug}`, lastModified: page.updatedAt })
    }

    pageOffset += listing.items.length
  }

  return entries
}

export async function renderSitemap(store: Repositories, origin: string): Promise<string> {
  const entries = await collectEntries(store)
  const base = origin.replace(/\/+$/, '')

  const urls = entries
    .map((entry) =>
      [
        '  <url>',
        `    <loc>${escapeXml(`${base}${entry.path}`)}</loc>`,
        `    <lastmod>${entry.lastModified.toISOString().slice(0, 10)}</lastmod>`,
        '  </url>',
      ].join('\n'),
    )
    .join('\n')

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n')
}

/**
 * `robots.txt`.
 *
 * The admin and the API are disallowed as well as unlinked: they are behind a
 * session, so a crawler reaching one gets a redirect to a sign-in form, and an
 * index full of those is noise nobody asked for.
 */
export function renderRobots(origin: string): string {
  const base = origin.replace(/\/+$/, '')

  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /api/',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n')
}
