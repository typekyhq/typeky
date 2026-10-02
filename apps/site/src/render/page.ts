import { blockToHtml, type PageKind, type Pagination, type RenderContext } from '@typeky/core'
import { defaultContext, type Page, type Post, type Product, type Repositories, type Site } from '@typeky/db'
import type { BlobPort, DbPort } from '@typeky/platform'
import { createLiquidRuntime, createRevisionCache, createTemplateLoader } from '@typeky/theme-kit'
import { BASELINE } from '@typeky/theme-default'
import { buildRenderContext, type ItemInput } from './context'

/**
 * The render pipeline.
 *
 * The order is the architecture's: resolve the route, load what the page needs,
 * assemble the context, render. Sorting, counting, resolving a media id and
 * turning blocks into HTML all happen in the first two steps, which is what keeps
 * the theme contract -- a template reads, it never queries -- something that can
 * actually be kept.
 *
 * Nothing is cached across requests: the loader is built per request, so a save
 * in another isolate is picked up by the next page rendered. Whole-page caching
 * belongs to the edge layer and arrives with it.
 */

export type Route =
  | { kind: 'home' }
  | { kind: 'posts'; page: number }
  | { kind: 'post'; slug: string }
  | { kind: 'products'; page: number }
  | { kind: 'product'; slug: string }
  | { kind: 'page'; slug: string }
  | { kind: 'notFound' }

/**
 * Where a request lands.
 *
 * `/posts` and `/products` are the lists; anything else is a page. A trailing
 * slash is ignored, because both spellings name the same page and answering them
 * differently is how duplicate content happens.
 */
export function resolveRoute(pathname: string): Route {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const segments = path.split('/').filter((segment) => segment !== '')

  if (segments.length === 0) return { kind: 'home' }

  if (segments[0] === 'posts' || segments[0] === 'products') {
    const list = segments[0] === 'posts' ? ('posts' as const) : ('products' as const)
    const single = segments[0] === 'posts' ? ('post' as const) : ('product' as const)

    if (segments.length === 1) return { kind: list, page: 1 }
    if (segments.length !== 2) return { kind: 'notFound' }

    // `/posts/2` is the second page; `/posts/hello` is a post called hello. The
    // number wins, so a post can never be named after a page number.
    const page = Number(segments[1])
    if (Number.isInteger(page) && page > 1) return { kind: list, page }

    return { kind: single, slug: segments[1]! }
  }

  if (segments.length === 1) return { kind: 'page', slug: segments[0]! }

  return { kind: 'notFound' }
}

/** How many items a list page shows. */
const PAGE_SIZE = 10

export interface RenderDependencies {
  repositories: Repositories | null
  /** The port the template loader reads overrides through. */
  db: DbPort | null
  blob: BlobPort | null
  /** Absolute origin, for canonical URLs and media links. */
  baseUrl: string
}

export async function renderPage(
  pathname: string,
  dependencies: RenderDependencies,
): Promise<{ status: number; html: string }> {
  const { repositories: store, db } = dependencies

  if (store === null || db === null) {
    return { status: 503, html: messagePage('This site has no database configured yet.') }
  }

  const ctx = defaultContext()
  const site = await store.sites.get(ctx)
  if (site === null) {
    return { status: 503, html: messagePage('This site has not been set up yet.') }
  }

  const resolveMedia = mediaResolver(dependencies.baseUrl)
  const common = {
    site: siteInput(site),
    baseUrl: dependencies.baseUrl,
    resolveMedia,
    defaults: seoDefaults(site),
  }

  const assembled = await assemble(resolveRoute(pathname), store, common)

  if (assembled === null) {
    return {
      status: 404,
      html: await renderWith(db, site, 'templates/404', {
        ...common,
        item: { kind: 'notFound', title: 'Not found', slug: '404', blocks: [], seo: {} },
      }),
    }
  }

  return {
    status: 200,
    html: await renderWith(db, site, templateFor(assembled.kind), assembled.input),
  }
}

/* ------------------------------------------------------------- assembly -- */

type ContextInput = Parameters<typeof buildRenderContext>[0]

interface Common {
  site: ContextInput['site']
  baseUrl: string
  resolveMedia: (id: string | null | undefined) => string | null
  defaults: { title?: string; description?: string }
}

/**
 * Loads what the page needs and hands back a context input.
 *
 * `null` means "there is no page here", which the caller turns into a 404 rather
 * than into an error: a slug that does not exist and a slug whose post is still a
 * draft are the same answer to a visitor, and saying which it was would leak
 * which posts exist.
 */
async function assemble(
  route: Route,
  store: Repositories,
  common: Common,
): Promise<{ kind: PageKind; input: ContextInput } | null> {
  const ctx = defaultContext()

  switch (route.kind) {
    case 'home': {
      const page = await store.pages.home(ctx)
      if (page === null || page.status !== 'published') return null
      return { kind: 'home', input: { ...common, item: pageInput(page, 'home') } }
    }

    case 'page': {
      const page = await store.pages.bySlug(ctx, route.slug)
      if (page === null || page.status !== 'published') return null
      return { kind: 'page', input: { ...common, item: pageInput(page, 'page') } }
    }

    case 'post': {
      const post = await store.posts.bySlug(ctx, route.slug)
      if (post === null || post.status !== 'published') return null
      return { kind: 'post', input: { ...common, item: postInput(post) } }
    }

    case 'product': {
      const product = await store.products.bySlug(ctx, route.slug)
      if (product === null || product.status !== 'published') return null
      return { kind: 'product', input: { ...common, item: productInput(product) } }
    }

    case 'posts': {
      const listing = await store.posts.list(ctx, {
        status: 'published',
        limit: PAGE_SIZE,
        offset: (route.page - 1) * PAGE_SIZE,
      })

      return {
        kind: 'posts',
        input: {
          ...common,
          pagination: pagination(route.page, listing.total, 'posts'),
          item: {
            kind: 'posts',
            title: 'Posts',
            slug: 'posts',
            blocks: [],
            seo: {},
            listItems: listing.items.map((post) => summaryOf(postInput(post), common.resolveMedia)),
          },
        },
      }
    }

    case 'products': {
      const listing = await store.products.list(ctx, {
        status: 'published',
        limit: PAGE_SIZE,
        offset: (route.page - 1) * PAGE_SIZE,
      })

      return {
        kind: 'products',
        input: {
          ...common,
          pagination: pagination(route.page, listing.total, 'products'),
          item: {
            kind: 'products',
            title: 'Products',
            slug: 'products',
            blocks: [],
            seo: {},
            listItems: listing.items.map((product) => summaryOf(productInput(product), common.resolveMedia)),
          },
        },
      }
    }

    case 'notFound':
      return null
  }
}

function pagination(page: number, total: number, base: 'posts' | 'products'): Pagination {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const href = (n: number): string => (n === 1 ? `/${base}` : `/${base}/${String(n)}`)

  return {
    page,
    pages,
    ...(page > 1 ? { previous_url: href(page - 1) } : {}),
    ...(page < pages ? { next_url: href(page + 1) } : {}),
  }
}

/* --------------------------------------------------------------- mapping -- */

function pageInput(page: Page, kind: PageKind): ItemInput {
  return {
    kind,
    title: page.title,
    slug: page.slug,
    blocks: page.blocks,
    seo: page.seo as Record<string, unknown>,
  }
}

function postInput(post: Post): ItemInput {
  return {
    kind: 'post',
    title: post.title,
    slug: post.slug,
    blocks: post.blocks,
    seo: post.seo as Record<string, unknown>,
    excerpt: post.excerpt,
    category: post.category,
    tags: post.tags,
    coverMediaId: post.coverMediaId,
    publishedAt: post.publishedAt,
  }
}

function productInput(product: Product): ItemInput {
  return {
    kind: 'product',
    title: product.title,
    slug: product.slug,
    blocks: product.blocks,
    seo: product.seo as Record<string, unknown>,
    excerpt: product.summary,
    coverMediaId: product.coverMediaId,
    gallery: product.gallery,
    specs: product.specs,
    priceLabel: product.priceLabel,
    ctaLabel: product.ctaLabel,
    ctaUrl: product.ctaUrl,
  }
}

/**
 * One row of a list, which is not the whole document.
 *
 * A card renders a title, a summary and maybe an image. Sending every post's body
 * would make a list page's context as large as the posts it lists, and nothing
 * would read it.
 */
function summaryOf(
  item: ItemInput,
  resolve: (id: string | null | undefined) => string | null,
): Record<string, unknown> {
  const cover = resolve(item.coverMediaId)

  return {
    title: item.title,
    slug: item.slug,
    url: contentUrlFor(item),
    ...(item.excerpt === null || item.excerpt === undefined ? {} : { excerpt: item.excerpt }),
    ...(item.category === null || item.category === undefined ? {} : { category: item.category }),
    ...(item.priceLabel === null || item.priceLabel === undefined ? {} : { price_label: item.priceLabel }),
    ...(item.publishedAt === null || item.publishedAt === undefined
      ? {}
      : { published_at: item.publishedAt.toISOString() }),
    ...(cover === null ? {} : { cover_url: cover }),
  }
}

function contentUrlFor(item: ItemInput): string {
  if (item.kind === 'post') return `/posts/${item.slug}`
  if (item.kind === 'product') return `/products/${item.slug}`
  return `/${item.slug}`
}

function siteInput(site: Site): ContextInput['site'] {
  return {
    name: site.name,
    tagline: site.tagline,
    logoMediaId: site.logoMediaId,
    // The row's settings are the platform's shape; the context is the template's.
    settings: { ...site.settings, language: 'en' },
    nav: site.nav,
  }
}

function seoDefaults(site: Site): { title?: string; description?: string } {
  const seo = site.settings.seo

  return {
    ...(typeof seo?.defaultTitle === 'string' ? { title: seo.defaultTitle } : {}),
    ...(typeof seo?.defaultDescription === 'string' ? { description: seo.defaultDescription } : {}),
  }
}

/**
 * A media id to a URL this site serves.
 *
 * The id rather than the storage key: a theme must not be able to name an object
 * in the bucket, and the id is what content stores anyway. When the id is missing
 * the field is left out, so a template's `{% if %}` renders no image rather than a
 * broken one.
 */
function mediaResolver(baseUrl: string): (id: string | null | undefined) => string | null {
  const base = baseUrl.replace(/\/+$/, '')

  return (id) => {
    if (id === null || id === undefined || id === '') return null
    return `${base}/media/${encodeURIComponent(id)}`
  }
}

function templateFor(kind: PageKind): string {
  switch (kind) {
    case 'home':
      return 'templates/home'
    case 'page':
      return 'templates/page'
    case 'post':
      return 'templates/post'
    case 'posts':
      return 'templates/posts'
    case 'product':
      return 'templates/product'
    case 'products':
      return 'templates/products'
    case 'notFound':
      return 'templates/404'
  }
}

/* ---------------------------------------------------------------- render -- */

async function renderWith(
  db: DbPort,
  site: Site,
  template: string,
  input: ContextInput,
): Promise<string> {
  const loader = createTemplateLoader({ db, theme: site.theme, baseline: BASELINE })

  const runtime = createLiquidRuntime({
    fs: loader.fs,
    // Keyed by the loader's revision, which is derived from the override rows --
    // so a cache filled before a save cannot answer after one, in any isolate.
    cache: createRevisionCache({ revision: () => loader.revision }),
    renderBlocks: (blocks) => (Array.isArray(blocks) ? blockToHtml(blocks as never) : ''),
  })

  const context: RenderContext = buildRenderContext(input)
  return runtime.renderFile(template, context)
}

/**
 * A page for when there is nothing to render a theme with.
 *
 * Not a template, and not HTML from a theme: with no site row there is no theme
 * to render one from, and pretending otherwise would be a page that cannot load
 * its own assets.
 */
function messagePage(message: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head><meta charset="utf-8">',
    // Nothing here is a page: it is what a deployment shows before it has been
    // set up, and it must not be indexed.
    '<meta name="robots" content="noindex">',
    '<title>Typeky</title></head>',
    '<body><main><h1>Almost there</h1>',
    `<p>${message}</p>`,
    '<p>Open the admin panel to finish setting this site up.</p>',
    '</main></body>',
    '</html>',
  ].join('\n')
}
