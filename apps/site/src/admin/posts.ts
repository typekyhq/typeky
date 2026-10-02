import {
  DEFAULT_POST_STATUS,
  getPostWriteSchema,
  postStatusRequestSchema,
  type PostListResponse,
  type PostResponse,
  type PostSummary,
} from '@typeky/api'
import { defaultContext, type Post, type Repositories } from '@typeky/db'
import type { Context } from 'hono'
import {
  apiError,
  describeIssues,
  readJsonBody,
  type AdminEnv,
  type RepositoryResolver,
} from './errors'

/**
 * The post resource.
 *
 * Two answer shapes on purpose. The collection answers with a summary, because a
 * body is Block JSON and twenty of them is a megabyte of JSON for a screen that
 * shows title, status and date. The single read answers with the whole document,
 * because that is what the editor needs to open.
 *
 * Everything is mapped field by field rather than spread from the domain object.
 * That is what makes a change to either side a compile error here instead of a
 * field that quietly stops being saved.
 */

/** A search long enough to be a mistake is truncated rather than refused. */
const MAX_SEARCH_LENGTH = 200

export async function readPosts(
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

  const result = await store.posts.list(defaultContext(), {
    ...(status === 'draft' || status === 'published' ? { status } : {}),
    ...(search === undefined || search.trim() === '' ? {} : { search }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  })

  const body: PostListResponse = {
    items: result.items.map(toSummary),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  }

  return c.json(body)
}

export async function readPost(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const post = await findPost(store, c.req.param('id'))
  if (post === null) return apiError(c, 'not_found', 'no post with that id')

  return c.json(toResponse(post))
}

export function createPost(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return writePost(c, repositories, undefined)
}

export function updatePost(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return writePost(c, repositories, c.req.param('id'))
}

/**
 * Creates when there is no id in the path, replaces when there is.
 *
 * One function rather than two, because the whole-document write is the same
 * statement either way and splitting it would be two places for the slug rule
 * and the field mapping to drift apart.
 */
async function writePost(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
  id: string | undefined,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = getPostWriteSchema().safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', describeIssues(parsed.error.issues))
  const body = parsed.data

  if (id !== undefined) {
    const existing = await findPost(store, id)
    if (existing === null) return apiError(c, 'not_found', 'no post with that id')
  }

  const owner = await slugOwner(store, body.slug, id)
  if (owner !== null) return slugTaken(c, body.slug, owner)

  try {
    const post = await store.posts.upsert(defaultContext(), {
      ...(id === undefined ? {} : { id }),
      title: body.title,
      slug: body.slug,
      excerpt: body.excerpt ?? null,
      coverMediaId: body.coverMediaId ?? null,
      blocks: body.blocks ?? [],
      tags: body.tags ?? [],
      category: body.category ?? null,
      seo: body.seo ?? {},
      status: body.status ?? DEFAULT_POST_STATUS,
    })

    return c.json(toResponse(post), id === undefined ? 201 : 200)
  } catch (error) {
    // The check above and the write are separate statements, so two operators
    // saving the same slug at the same moment both pass the check. The unique
    // index is the real arbiter, and its error should reach the operator as the
    // same answer the check would have given rather than as a 500.
    if (isUniqueViolation(error)) return slugTaken(c, body.slug, null)
    throw error
  }
}

/**
 * Publishing and unpublishing from the list, where the full document is not at
 * hand.
 *
 * The repository writes whole documents, so this reads the post and writes it
 * back with one field changed. That is not a patch dressed up: it is the same
 * statement the editor makes, which is what keeps a post published from the list
 * identical to one published from the editor.
 */
export async function setPostStatus(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = postStatusRequestSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', 'status must be draft or published')

  const post = await findPost(store, c.req.param('id'))
  if (post === null) return apiError(c, 'not_found', 'no post with that id')

  const saved = await store.posts.upsert(defaultContext(), {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    coverMediaId: post.coverMediaId,
    blocks: post.blocks,
    tags: post.tags,
    category: post.category,
    seo: post.seo,
    status: parsed.data.status,
  })

  return c.json(toResponse(saved))
}

export async function deletePost(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const id = c.req.param('id')
  if (id === undefined) return apiError(c, 'not_found', 'no post with that id')

  const removed = await store.posts.remove(defaultContext(), id)
  if (!removed) return apiError(c, 'not_found', 'no post with that id')

  return c.body(null, 204)
}

/* -------------------------------------------------------------- helpers -- */

async function findPost(store: Repositories, id: string | undefined): Promise<Post | null> {
  if (id === undefined || id === '') return null
  return store.posts.byId(defaultContext(), id)
}

/**
 * The post already holding this slug, if it is not the one being written.
 *
 * Answered by the repository rather than by counting rows, so the message can
 * name the post that has it -- "already used" without saying by what leaves the
 * operator to go looking.
 */
async function slugOwner(
  store: Repositories,
  slug: string,
  exceptId: string | undefined,
): Promise<Post | null> {
  const existing = await store.posts.bySlug(defaultContext(), slug)
  if (existing === null) return null
  return existing.id === exceptId ? null : existing
}

function slugTaken(c: Context<AdminEnv>, slug: string, owner: Post | null): Response {
  const message =
    owner === null
      ? `The slug "${slug}" is already used by another post.`
      : `The slug "${slug}" is already used by "${owner.title}".`

  return apiError(c, 'slug_taken', message)
}

/**
 * SQLite reports a unique index violation in the message. Matching on text is
 * unpleasant, but the alternative is letting the one race an operator can cause
 * by hand surface as an internal error.
 */
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}

function toInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function toSummary(post: Post): PostSummary {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    category: post.category,
    tags: post.tags,
    status: post.status,
    revision: post.revision,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    updatedAt: post.updatedAt.toISOString(),
  }
}

function toResponse(post: Post): PostResponse {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    coverMediaId: post.coverMediaId,
    blocks: post.blocks,
    tags: post.tags,
    category: post.category,
    seo: post.seo,
    status: post.status,
    revision: post.revision,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  }
}
