import {
  getPageWriteSchema,
  postStatusRequestSchema,
  type PageListResponse,
  type PageResponse,
  type PageSummary,
} from '@typeky/api'
import { defaultContext, type Page, type Repositories } from '@typeky/db'
import { reservedPathFor } from '@typeky/api'
import { adminPathOf } from '../admin-config'
import { createLiquidRuntime } from '@typeky/theme-kit'
import type { Context } from 'hono'
import {
  apiError,
  describeIssues,
  isUniqueViolation,
  readJsonBody,
  type AdminEnv,
  type RepositoryResolver,
} from './errors'
import { readListQuery, runBulk } from './listing'

/**
 * The page resource.
 *
 * The same shape as posts, with two differences that come from the data model:
 * a page has a sort order, and exactly one of them may be the home page. That
 * second one is an action rather than a field -- see the note in the contract,
 * and the partial unique index that backs it.
 *
 * A page may also be its own document, in which case its source is rendered with
 * the site's context instead of the theme's page template.
 */

/**
 * One engine for validating a custom page's source before it is stored.
 *
 * Module scope because parsing needs no filesystem and no data, and the same
 * choice the theme handler makes. `cache: false` because a validating engine never
 * renders the same source twice.
 */
const validator = createLiquidRuntime({ cache: false })

export async function readPages(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = readListQuery(c)
  if (!parsed.ok) return apiError(c, 'invalid_request', parsed.message)

  const result = await store.pages.list(defaultContext(), parsed.query)

  const body: PageListResponse = {
    items: result.items.map(toSummary),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  }

  return c.json(body)
}

export async function readPage(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const page = await findPage(store, c.req.param('id'))
  if (page === null) return apiError(c, 'not_found', 'no page with that id')

  return c.json(toResponse(page))
}

export function createPage(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return writePage(c, repositories, undefined)
}

export function updatePage(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return writePage(c, repositories, c.req.param('id'))
}

/** Publish, unpublish or delete a selection, in one request. */
export function bulkPages(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return runBulk(c, repositories, (store) => store.pages)
}

async function writePage(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
  id: string | undefined,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = getPageWriteSchema().safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', describeIssues(parsed.error.issues))
  const body = parsed.data

  if (id !== undefined) {
    const existing = await findPage(store, id)
    if (existing === null) return apiError(c, 'not_found', 'no page with that id')
  }

  const owner = await slugOwner(store, body.slug, id)
  if (owner !== null) return slugTaken(c, body.slug, owner)

  // A page's URL is `/<slug>`, so this is where a page can take a path the platform
  // -- or the operator -- needs. Checked before anything is written, and before the
  // slug-owner check would have been enough on its own: an unused slug is not the
  // same as an available one.
  const site = await store.sites.get(defaultContext())
  // The panel's own segment is reserved as well, and it is not in the platform's
  // list because the operator chose it: a page slugged with it would shadow the
  // panel, and the panel is how they would have gone to fix that.
  const reserved = reservedPathFor(body.slug, [
    ...(site?.settings.reservedPaths ?? []),
    `/${adminPathOf(site?.settings)}`,
  ])
  if (reserved !== null) {
    return apiError(
      c,
      'slug_reserved',
      `"${reserved}" is reserved; the page would take that address.`,
    )
  }

  const useLayout = body.useLayout ?? true
  const customSource = body.customSource ?? ''

  // A page that is its own document has to have one. Refusing an empty source is
  // the guard that keeps `useLayout: false` from meaning "publish a blank page at
  // a real URL", which the flag on its own would be.
  if (!useLayout && customSource.trim() === '') {
    return apiError(
      c,
      'invalid_request',
      'a page that is its own document needs its template source',
    )
  }

  // Parsed by the engine that will render it, before it is stored: a source that
  // does not parse is a 500 at request time, and finding that out now, with a
  // line, is the whole point of checking before a save.
  //
  // Only when it is what the page renders from. A source kept aside while the
  // theme layout is in charge cannot break a page, and refusing a save over text
  // nobody is looking at would be a worse answer than storing it.
  if (!useLayout) {
    const problem = validator.validate(customSource)
    if (problem !== null) {
      return apiError(c, 'invalid_request', problem.message, problem.line ?? undefined)
    }
  }

  try {
    const page = await store.pages.upsert(defaultContext(), {
      ...(id === undefined ? {} : { id }),
      title: body.title,
      slug: body.slug,
      blocks: body.blocks ?? [],
      // Both are stored whichever way the switch is set: toggling it by accident
      // should not throw away the other mode's work. The stored text is the
      // author's, verbatim -- only whitespace-only counts as empty.
      useLayout,
      customSource: customSource.trim() === '' ? null : customSource,
      seo: body.seo ?? {},
      status: body.status,
      sortOrder: body.sortOrder,
    })

    return c.json(toResponse(page), id === undefined ? 201 : 200)
  } catch (error) {
    if (isUniqueViolation(error)) return slugTaken(c, body.slug, null)
    throw error
  }
}

/**
 * Publishes or unpublishes, reading the page and writing it back.
 *
 * The write is a whole document, so everything the caller is not changing has
 * to be carried across -- and is, from what is stored rather than from what the
 * caller sent, so publishing from the list cannot blank a body.
 */
export async function setPageStatus(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = postStatusRequestSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', 'status must be draft or published')

  const page = await findPage(store, c.req.param('id'))
  if (page === null) return apiError(c, 'not_found', 'no page with that id')

  const saved = await store.pages.upsert(defaultContext(), {
    id: page.id,
    title: page.title,
    slug: page.slug,
    blocks: page.blocks,
    seo: page.seo,
    status: parsed.data.status,
    sortOrder: page.sortOrder,
  })

  return c.json(toResponse(saved))
}

/**
 * Makes this page the home page.
 *
 * The repository clears the previous one and sets this one in a single batch, so
 * no reader can observe two home pages, and the partial unique index refuses the
 * state outright if anything else ever tries.
 */
export async function setPageHome(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const id = c.req.param('id')
  if (id === undefined || id === '') return apiError(c, 'not_found', 'no page with that id')

  const current = await findPage(store, id)
  if (current === null) return apiError(c, 'not_found', 'no page with that id')

  const saved = await store.pages.setHome(defaultContext(), id)
  return c.json(toResponse(saved))
}

export async function deletePage(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const id = c.req.param('id')
  if (id === undefined) return apiError(c, 'not_found', 'no page with that id')

  const removed = await store.pages.remove(defaultContext(), id)
  if (!removed) return apiError(c, 'not_found', 'no page with that id')

  return c.body(null, 204)
}

/* -------------------------------------------------------------- helpers -- */

async function findPage(store: Repositories, id: string | undefined): Promise<Page | null> {
  if (id === undefined || id === '') return null
  return store.pages.byId(defaultContext(), id)
}

async function slugOwner(
  store: Repositories,
  slug: string,
  exceptId: string | undefined,
): Promise<Page | null> {
  const existing = await store.pages.bySlug(defaultContext(), slug)
  if (existing === null) return null
  return existing.id === exceptId ? null : existing
}

function slugTaken(c: Context<AdminEnv>, slug: string, owner: Page | null): Response {
  const message =
    owner === null
      ? `The slug "${slug}" is already used by another page.`
      : `The slug "${slug}" is already used by "${owner.title}".`

  return apiError(c, 'slug_taken', message)
}


function toSummary(page: Page): PageSummary {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    useLayout: page.useLayout,
    status: page.status,
    isHome: page.isHome,
    sortOrder: page.sortOrder,
    revision: page.revision,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    updatedAt: page.updatedAt.toISOString(),
  }
}

function toResponse(page: Page): PageResponse {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
    blocks: page.blocks,
    useLayout: page.useLayout,
    customSource: page.customSource,
    seo: page.seo,
    status: page.status,
    isHome: page.isHome,
    sortOrder: page.sortOrder,
    revision: page.revision,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  }
}
