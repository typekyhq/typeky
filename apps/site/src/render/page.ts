import type { PageKind, Pagination, RenderContext } from '@typeky/core'
import {
  defaultContext,
  type ContentType,
  type Page,
  type Post,
  type Product,
  type Repositories,
  type Site,
  type Term,
} from '@typeky/db'
import type { BlobPort, DbPort } from '@typeky/platform'
import { createLiquidRuntime, createRevisionCache, createTemplateLoader } from '@typeky/theme-kit'
import { BASELINE } from '@typeky/theme-default'
import { buildRenderContext, type ItemInput, type TemplateTerm } from './context'
import { robotsRules, seoDefaults } from './seo-settings'
import { renderDocument, renderPageSource, themeRuntimeOptions } from './theme-runtime'

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

/** How many items a list page shows. Shared with the sitemap, which lists them. */
export const PAGE_SIZE = 10

export interface RenderDependencies {
  repositories: Repositories | null
  /** The port the template loader reads overrides through. */
  db: DbPort | null
  blob: BlobPort | null
  /** Absolute origin, for canonical URLs and media links. */
  baseUrl: string
  /**
   * Whether a licence removes the attribution.
   *
   * Resolved by the caller because it depends on the hostname the request arrived
   * on, and this function is meant to be callable without an environment.
   */
  whiteLabel: boolean
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
    site: siteInput(site, dependencies.whiteLabel),
    baseUrl: dependencies.baseUrl,
    resolveMedia,
    defaults: seoDefaults(site.settings),
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

  // A page that is its own document skips the theme's template, not the theme
  // itself: the same engine, the same context, so `{% render 'snippets/...' %}` and
  // `asset_url` still mean what they mean everywhere else.
  if (assembled.document !== undefined) {
    return { status: 200, html: await renderCustom(db, site, assembled.document, assembled.input) }
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
): Promise<{ kind: PageKind; input: ContextInput; document?: string } | null> {
  const ctx = defaultContext()

  switch (route.kind) {
    case 'home': {
      const page = await store.pages.home(ctx)
      if (page === null || page.status !== 'published') return null
      return { kind: 'home', input: { ...common, item: pageInput(page, 'home') }, ...documentOf(page) }
    }

    case 'page': {
      const page = await store.pages.bySlug(ctx, route.slug)
      if (page === null || page.status !== 'published') return null
      return { kind: 'page', input: { ...common, item: pageInput(page, 'page') }, ...documentOf(page) }
    }

    case 'post': {
      const post = await store.posts.bySlug(ctx, route.slug)
      if (post === null || post.status !== 'published') return null
      const terms = await termReader(store, ctx, 'post').one(post.id)
      return { kind: 'post', input: { ...common, item: postInput(post, terms) } }
    }

    case 'product': {
      const product = await store.products.bySlug(ctx, route.slug)
      if (product === null || product.status !== 'published') return null
      const terms = await termReader(store, ctx, 'product').one(product.id)
      return { kind: 'product', input: { ...common, item: productInput(product, terms) } }
    }

    case 'posts': {
      const listing = await store.posts.list(ctx, {
        status: 'published',
        limit: PAGE_SIZE,
        offset: (route.page - 1) * PAGE_SIZE,
      })

      const terms = await termReader(store, ctx, 'post').many(listing.items.map((post) => post.id))

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
            listItems: listing.items.map((post) =>
            summaryOf(postInput(post, terms.get(post.id) ?? []), common.resolveMedia),
          ),
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

      const terms = await termReader(store, ctx, 'product').many(
        listing.items.map((product) => product.id),
      )

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
            listItems: listing.items.map((product) =>
            summaryOf(productInput(product, terms.get(product.id) ?? []), common.resolveMedia),
          ),
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
    updatedAt: page.updatedAt,
  }
}

/**
 * Reads the terms a page's content carries, shaped for a template.
 *
 * The vocabulary names are fetched at most once per render and only if some term
 * is actually printed: a site with no taxonomy pays nothing, and one that has one
 * pays a single query rather than one per term. That is what the closure is for --
 * `forContentMany` answers the rows, and this answers what a template reads.
 */
function termReader(store: Repositories, ctx: ReturnType<typeof defaultContext>, contentType: ContentType) {
  let vocabularyNames: Promise<Map<string, string>> | undefined

  const names = async (): Promise<Map<string, string>> => {
    vocabularyNames ??= store.vocabularies
      .list(ctx)
      .then((list) => new Map(list.map((vocabulary) => [vocabulary.id, vocabulary.name])))
    return vocabularyNames
  }

  const shape = async (terms: Term[]): Promise<TemplateTerm[]> => {
    if (terms.length === 0) return []
    const byId = await names()
    return terms.map((term) => ({
      name: term.name,
      slug: term.slug,
      vocabulary: byId.get(term.vocabularyId) ?? '',
    }))
  }

  return {
    async one(contentId: string): Promise<TemplateTerm[]> {
      return shape(await store.terms.forContent(ctx, contentType, contentId))
    },
    async many(contentIds: string[]): Promise<Map<string, TemplateTerm[]>> {
      const grouped = await store.terms.forContentMany(ctx, contentType, contentIds)
      const out = new Map<string, TemplateTerm[]>()
      for (const [contentId, terms] of grouped) out.set(contentId, await shape(terms))
      return out
    },
  }
}

function postInput(post: Post, terms: TemplateTerm[]): ItemInput {
  return {
    kind: 'post',
    title: post.title,
    slug: post.slug,
    blocks: post.blocks,
    seo: post.seo as Record<string, unknown>,
    excerpt: post.excerpt,
    terms,
    tags: post.tags,
    coverMediaId: post.coverMediaId,
    publishedAt: post.publishedAt,
    updatedAt: post.updatedAt,
  }
}

function productInput(product: Product, terms: TemplateTerm[]): ItemInput {
  return {
    kind: 'product',
    title: product.title,
    slug: product.slug,
    blocks: product.blocks,
    seo: product.seo as Record<string, unknown>,
    excerpt: product.summary,
    terms,
    coverMediaId: product.coverMediaId,
    gallery: product.gallery,
    specs: product.specs,
    priceLabel: product.priceLabel,
    ctaLabel: product.ctaLabel,
    ctaUrl: product.ctaUrl,
    updatedAt: product.updatedAt,
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
    ...(item.terms === undefined || item.terms.length === 0 ? {} : { terms: item.terms }),
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

function siteInput(site: Site, whiteLabel: boolean): ContextInput['site'] {
  return {
    name: site.name,
    tagline: site.tagline,
    logoMediaId: site.logoMediaId,
    faviconMediaId: site.faviconMediaId,
    // Passed through as stored. It used to be spread with a hardcoded `language:
    // 'en'`, which meant a site could not be anything else.
    settings: { ...site.settings },
    nav: site.nav,
    whiteLabel,
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

/**
 * The runtime every render of this site shares.
 *
 * One builder rather than one per entry point: the page that is its own document
 * and the page that is the theme's both need the same loader, the same asset
 * versions and the same cache, and two of those drifting apart is the bug this
 * file already carries a comment about.
 */
function runtimeFor(db: DbPort, site: Site) {
  const loader = createTemplateLoader({ db, theme: site.theme, baseline: BASELINE })

  return createLiquidRuntime({
    ...themeRuntimeOptions(loader.fs),
    // Keyed by the loader's revision, which is derived from the override rows --
    // so a cache filled before a save cannot answer after one, in any isolate.
    cache: createRevisionCache({ revision: () => loader.revision }),
  })
}

async function renderWith(
  db: DbPort,
  site: Site,
  template: string,
  input: ContextInput,
): Promise<string> {
  return renderDocument(runtimeFor(db, site), template, buildRenderContext(input), {
    noindex: robotsRules(site.settings).noindex,
  })
}

async function renderCustom(
  db: DbPort,
  site: Site,
  source: string,
  input: ContextInput,
): Promise<string> {
  return renderPageSource(runtimeFor(db, site), source, buildRenderContext(input), {
    noindex: robotsRules(site.settings).noindex,
  })
}

/**
 * The page's own source, when it has one.
 *
 * The flag alone is not enough: a page marked as its own document with no source
 * falls back to the theme, because an empty body with an attribution badge is not
 * a page. The admin refuses to save that combination, so this is the floor under a
 * rule rather than the rule itself.
 */
function documentOf(page: Page): { document: string } | Record<string, never> {
  // `!== false` rather than a truthiness test: anything that is not an explicit
  // "no layout" -- a row written before this field existed, a fixture that has not
  // caught up -- is a page the theme renders, which is what every page was before
  // this field existed. Being strict here would turn a shape surprise into a 500.
  if (page.useLayout !== false) return {}

  const source = (page.customSource ?? '').trim()
  return source === '' ? {} : { document: source }
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
