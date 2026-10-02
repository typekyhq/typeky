import {
  DEFAULT_POST_STATUS,
  getPostWriteSchema,
  postStatusRequestSchema,
  type PostListResponse,
  type PostResponse,
  type PostSummary,
} from '@typeky/api'
import { defaultContext, type Post, type Repositories, type Term } from '@typeky/db'
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


export async function readPosts(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = readListQuery(c)
  if (!parsed.ok) return apiError(c, 'invalid_request', parsed.message)

  const result = await store.posts.list(defaultContext(), parsed.query)
  // One query for the page rather than one per row: the list shows a title's
  // terms, and asking row by row is a query per title.
  const terms = await store.terms.forContentMany(
    defaultContext(),
    'post',
    result.items.map((post) => post.id),
  )

  const body: PostListResponse = {
    items: result.items.map((post) => toSummary(post, terms.get(post.id) ?? [])),
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

  return c.json(await respond(store, post))
}

export function createPost(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return writePost(c, repositories, undefined)
}

export function updatePost(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return writePost(c, repositories, c.req.param('id'))
}

/** Publish, unpublish or delete a selection, in one request. */
export function bulkPosts(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return runBulk(c, repositories, (store) => store.posts)
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
      seo: body.seo ?? {},
      status: body.status ?? DEFAULT_POST_STATUS,
    })

    // After the row, because a new post has no id until it is written. If a term
    // is refused the post stays saved without it, and the message says exactly
    // that rather than leaving the operator to work out which half happened.
    try {
      await store.terms.assign(defaultContext(), 'post', post.id, body.termIds ?? [])
    } catch (error) {
      return apiError(
        c,
        'invalid_request',
        `the post was saved, but its terms were not: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    return c.json(await respond(store, post), id === undefined ? 201 : 200)
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
    seo: post.seo,
    status: parsed.data.status,
  })

  return c.json(await respond(store, saved))
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

/** What a template or an editor needs about a term, and nothing else. */
function toTermRef(term: Term): TermRef {
  return { id: term.id, name: term.name, slug: term.slug }
}

/** A saved post with the terms it now carries, which is what a write answers. */
async function respond(store: Repositories, post: Post): Promise<PostResponse> {
  return toResponse(post, await store.terms.forContent(defaultContext(), 'post', post.id))
}

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


function toSummary(post: Post, terms: Term[]): PostSummary {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    terms: terms.map(toTermRef),
    tags: post.tags,
    status: post.status,
    revision: post.revision,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    updatedAt: post.updatedAt.toISOString(),
  }
}

function toResponse(post: Post, terms: Term[]): PostResponse {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    coverMediaId: post.coverMediaId,
    blocks: post.blocks,
    tags: post.tags,
    terms: terms.map(toTermRef),
    seo: post.seo,
    status: post.status,
    revision: post.revision,
    publishedAt: post.publishedAt?.toISOString() ?? null,
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  }
}
