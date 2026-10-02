import {
  getPageWriteSchema,
  postStatusRequestSchema,
  type PageListResponse,
  type PageResponse,
  type PageSummary,
} from '@typeky/api'
import { defaultContext, type Page, type Repositories } from '@typeky/db'
import type { Context } from 'hono'
import {
  apiError,
  describeIssues,
  readJsonBody,
  type AdminEnv,
  type RepositoryResolver,
} from './errors'

/**
 * The page resource.
 *
 * The same shape as posts, with two differences that come from the data model:
 * a page has a sort order, and exactly one of them may be the home page. That
 * second one is an action rather than a field -- see the note in the contract,
 * and the partial unique index that backs it.
 */

const MAX_SEARCH_LENGTH = 200

export async function readPages(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const status = c.req.query('status')
  if (status !== undefined && status !== '' && status !== 'draft' && status !== 'published') {
    return apiError(c, 'invalid_request', 'status must be draft or published')
  }

  const search = c.req.query('search')?.slice(0, MAX_SEARCH_LENGTH)
  const limit = toInteger(c.req.query('limit'))
  const offset = toInteger(c.req.query('offset'))

  const result = await store.pages.list(defaultContext(), {
    ...(status === 'draft' || status === 'published' ? { status } : {}),
    ...(search === undefined || search.trim() === '' ? {} : { search }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  })

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

  try {
    const page = await store.pages.upsert(defaultContext(), {
      ...(id === undefined ? {} : { id }),
      title: body.title,
      slug: body.slug,
      blocks: body.blocks ?? [],
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

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

function toInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function toSummary(page: Page): PageSummary {
  return {
    id: page.id,
    title: page.title,
    slug: page.slug,
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
