import {
  getProductWriteSchema,
  postStatusRequestSchema,
  type ProductListResponse,
  type ProductResponse,
  type ProductSummary,
} from '@typeky/api'
import { defaultContext, type Product, type Repositories, type Term } from '@typeky/db'
import type { TermRef } from '@typeky/api'
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
 * The product resource.
 *
 * Same shape as the other two, with the fields only a product has: a gallery, a
 * specification table, a price label and a call to action. All of them are
 * copied across field by field on every write, because a whole-document write
 * that dropped one would silently empty a product's gallery.
 */


export async function readProducts(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = readListQuery(c)
  if (!parsed.ok) return apiError(c, 'invalid_request', parsed.message)

  const result = await store.products.list(defaultContext(), parsed.query)
  const terms = await store.terms.forContentMany(
    defaultContext(),
    'product',
    result.items.map((product) => product.id),
  )

  const body: ProductListResponse = {
    items: result.items.map((product) => toSummary(product, terms.get(product.id) ?? [])),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  }

  return c.json(body)
}

export async function readProduct(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const product = await findProduct(store, c.req.param('id'))
  if (product === null) return apiError(c, 'not_found', 'no product with that id')

  return c.json(await respond(store, product))
}

export function createProduct(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  return writeProduct(c, repositories, undefined)
}

export function updateProduct(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  return writeProduct(c, repositories, c.req.param('id'))
}

/** Publish, unpublish or delete a selection, in one request. */
export function bulkProducts(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  return runBulk(c, repositories, (store) => store.products)
}

async function writeProduct(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
  id: string | undefined,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = getProductWriteSchema().safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', describeIssues(parsed.error.issues))
  const body = parsed.data

  if (id !== undefined) {
    const existing = await findProduct(store, id)
    if (existing === null) return apiError(c, 'not_found', 'no product with that id')
  }

  const owner = await slugOwner(store, body.slug, id)
  if (owner !== null) return slugTaken(c, body.slug, owner)

  try {
    const product = await store.products.upsert(defaultContext(), {
      ...(id === undefined ? {} : { id }),
      title: body.title,
      slug: body.slug,
      summary: body.summary ?? null,
      blocks: body.blocks ?? [],
      coverMediaId: body.coverMediaId ?? null,
      gallery: body.gallery ?? [],
      specs: body.specs ?? [],
      priceLabel: body.priceLabel ?? null,
      ctaLabel: body.ctaLabel ?? null,
      ctaUrl: body.ctaUrl ?? null,
      seo: body.seo ?? {},
      status: body.status,
      sortOrder: body.sortOrder,
    })

    // After the row, because a new product has no id until it is written. A term
    // the repository refuses leaves the product saved without it, and the message
    // says so rather than leaving the operator to guess which half happened.
    try {
      await store.terms.assign(defaultContext(), 'product', product.id, body.termIds ?? [])
    } catch (error) {
      return apiError(
        c,
        'invalid_request',
        `the product was saved, but its terms were not: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    return c.json(await respond(store, product), id === undefined ? 201 : 200)
  } catch (error) {
    if (isUniqueViolation(error)) return slugTaken(c, body.slug, null)
    throw error
  }
}

export async function setProductStatus(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = postStatusRequestSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', 'status must be draft or published')

  const product = await findProduct(store, c.req.param('id'))
  if (product === null) return apiError(c, 'not_found', 'no product with that id')

  // Read from storage rather than from the caller: publishing from a list must
  // not be able to blank a gallery or a body.
  const saved = await store.products.upsert(defaultContext(), {
    id: product.id,
    title: product.title,
    slug: product.slug,
    summary: product.summary,
    blocks: product.blocks,
    coverMediaId: product.coverMediaId,
    gallery: product.gallery,
    specs: product.specs,
    priceLabel: product.priceLabel,
    ctaLabel: product.ctaLabel,
    ctaUrl: product.ctaUrl,
    seo: product.seo,
    status: parsed.data.status,
    sortOrder: product.sortOrder,
  })

  return c.json(await respond(store, saved))
}

export async function deleteProduct(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const id = c.req.param('id')
  if (id === undefined) return apiError(c, 'not_found', 'no product with that id')

  const removed = await store.products.remove(defaultContext(), id)
  if (!removed) return apiError(c, 'not_found', 'no product with that id')

  return c.body(null, 204)
}

/* -------------------------------------------------------------- helpers -- */

async function findProduct(store: Repositories, id: string | undefined): Promise<Product | null> {
  if (id === undefined || id === '') return null
  return store.products.byId(defaultContext(), id)
}

async function slugOwner(
  store: Repositories,
  slug: string,
  exceptId: string | undefined,
): Promise<Product | null> {
  const existing = await store.products.bySlug(defaultContext(), slug)
  if (existing === null) return null
  return existing.id === exceptId ? null : existing
}

function slugTaken(c: Context<AdminEnv>, slug: string, owner: Product | null): Response {
  const message =
    owner === null
      ? `The slug "${slug}" is already used by another product.`
      : `The slug "${slug}" is already used by "${owner.title}".`

  return apiError(c, 'slug_taken', message)
}


/** What a template or an editor needs about a term, and nothing else. */
function toTermRef(term: Term): TermRef {
  return { id: term.id, name: term.name, slug: term.slug }
}

/** A saved product with the terms it now carries, which is what a write answers. */
async function respond(store: Repositories, product: Product): Promise<ProductResponse> {
  return toResponse(product, await store.terms.forContent(defaultContext(), 'product', product.id))
}

function toSummary(product: Product, terms: Term[]): ProductSummary {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    summary: product.summary,
    terms: terms.map(toTermRef),
    priceLabel: product.priceLabel,
    status: product.status,
    sortOrder: product.sortOrder,
    revision: product.revision,
    publishedAt: product.publishedAt?.toISOString() ?? null,
    updatedAt: product.updatedAt.toISOString(),
  }
}

function toResponse(product: Product, terms: Term[]): ProductResponse {
  return {
    id: product.id,
    title: product.title,
    slug: product.slug,
    summary: product.summary,
    blocks: product.blocks,
    coverMediaId: product.coverMediaId,
    gallery: product.gallery,
    specs: product.specs,
    priceLabel: product.priceLabel,
    ctaLabel: product.ctaLabel,
    ctaUrl: product.ctaUrl,
    terms: terms.map(toTermRef),
    seo: product.seo,
    status: product.status,
    sortOrder: product.sortOrder,
    revision: product.revision,
    publishedAt: product.publishedAt?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  }
}
