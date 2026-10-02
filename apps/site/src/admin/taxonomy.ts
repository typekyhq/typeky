import {
  termWriteSchema,
  vocabularyWriteSchema,
  type TaxonomyResponse,
  type Term,
  type Vocabulary,
} from '@typeky/api'
import { defaultContext, type Repositories, type Term as TermRow, type Vocabulary as VocabularyRow } from '@typeky/db'
import type { Context } from 'hono'
import { apiError, describeIssues, isUniqueViolation, readJsonBody, type AdminEnv, type RepositoryResolver } from './errors'

/**
 * The taxonomy: vocabularies, their terms, and which content types may draw from
 * them.
 *
 * This is the screen's whole API. Everything the taxonomy page renders arrives in
 * one `GET`, because the vocabularies and the terms of the selected vocabulary are
 * two halves of one list rather than two resources -- a request per selection
 * would put a spinner between them.
 *
 * Terms are flat on the wire with a `depth`, which is what lets the tree be a
 * list of rows. The depth is computed here rather than stored: a stored depth is
 * one more thing that has to be rewritten when a branch moves, and getting that
 * wrong is a tree that renders lopsided.
 */

export async function readTaxonomy(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const ctx = defaultContext()
  const vocabularies = await store.vocabularies.list(ctx)
  if (vocabularies.length === 0) {
    const empty: TaxonomyResponse = { vocabularies: [], terms: [] }
    return c.json(empty)
  }

  // One grouped count for every term, rather than one query per row.
  const usage = await store.terms.usageCounts(ctx)

  const terms: Term[] = []
  for (const vocabulary of vocabularies) {
    // `list` answers depth first, so a parent is always seen before its children
    // and one pass is enough to know how deep each row sits.
    const rows = await store.terms.list(ctx, vocabulary.id)
    const depth = new Map<string, number>()

    for (const row of rows) {
      const level = row.parentId === null ? 0 : (depth.get(row.parentId) ?? 0) + 1
      depth.set(row.id, level)
      terms.push(toTerm(row, level, usage.get(row.id) ?? 0))
    }
  }

  const body: TaxonomyResponse = { vocabularies: vocabularies.map(toVocabulary), terms }
  return c.json(body)
}

export function createVocabulary(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  return writeVocabulary(c, repositories, undefined)
}

export function updateVocabulary(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  return writeVocabulary(c, repositories, c.req.param('id'))
}

/**
 * Removes a vocabulary, which takes its terms and their assignments with it.
 *
 * Not a soft delete and not refused when terms are in use: the schema cascades,
 * and the screen warns before asking. A vocabulary that can only be deleted once
 * it is empty is a vocabulary that is never deleted.
 */
export async function deleteVocabulary(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const id = c.req.param('id')
  if (id === undefined) return apiError(c, 'not_found', 'no vocabulary with that id')

  const removed = await store.vocabularies.remove(defaultContext(), id)
  if (!removed) return apiError(c, 'not_found', 'no vocabulary with that id')

  return c.body(null, 204)
}

export function createTerm(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return writeTerm(c, repositories, undefined)
}

export function updateTerm(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  return writeTerm(c, repositories, c.req.param('id'))
}

export async function deleteTerm(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const id = c.req.param('id')
  if (id === undefined) return apiError(c, 'not_found', 'no term with that id')

  const removed = await store.terms.remove(defaultContext(), id)
  if (!removed) return apiError(c, 'not_found', 'no term with that id')

  return c.body(null, 204)
}

/* -------------------------------------------------------------- helpers -- */

async function writeVocabulary(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
  id: string | undefined,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = vocabularyWriteSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', describeIssues(parsed.error.issues))

  const ctx = defaultContext()
  if (id !== undefined) {
    const existing = await store.vocabularies.byId(ctx, id)
    if (existing === null) return apiError(c, 'not_found', 'no vocabulary with that id')
  }

  try {
    const saved = await store.vocabularies.upsert(ctx, {
      ...(id === undefined ? {} : { id }),
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      ...(parsed.data.contentTypes === undefined ? {} : { contentTypes: parsed.data.contentTypes }),
    })

    return c.json(toVocabulary(saved), id === undefined ? 201 : 200)
  } catch (error) {
    // The name is unique, and like every other unique column here the check and
    // the write are separate statements, so the index is the real arbiter.
    if (isUniqueViolation(error)) {
      return apiError(c, 'name_taken', `A vocabulary called "${parsed.data.name}" already exists.`)
    }
    throw error
  }
}

async function writeTerm(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
  id: string | undefined,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = termWriteSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', describeIssues(parsed.error.issues))

  const ctx = defaultContext()
  const vocabulary = await store.vocabularies.byId(ctx, parsed.data.vocabularyId)
  if (vocabulary === null) return apiError(c, 'not_found', 'no vocabulary with that id')

  if (id !== undefined) {
    const existing = await store.terms.byId(ctx, id)
    if (existing === null) return apiError(c, 'not_found', 'no term with that id')
  }

  try {
    const saved = await store.terms.upsert(ctx, {
      ...(id === undefined ? {} : { id }),
      vocabularyId: parsed.data.vocabularyId,
      parentId: parsed.data.parentId ?? null,
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description ?? null,
    })

    return c.json(await describe(store, saved), id === undefined ? 201 : 200)
  } catch (error) {
    if (isUniqueViolation(error)) {
      return apiError(
        c,
        'slug_taken',
        `The term "${parsed.data.slug}" is already used in this vocabulary.`,
      )
    }

    // A parent from another vocabulary and a move that would make a cycle are
    // both refused by the repository, which is where the tree's invariants live.
    // They are the operator's mistake, not the server's, so they answer 400.
    if (error instanceof Error) return apiError(c, 'invalid_request', error.message)
    throw error
  }
}

/** A single term with the two fields that are derived rather than stored. */
async function describe(store: Repositories, row: TermRow): Promise<Term> {
  const ctx = defaultContext()
  const ancestry = await store.terms.path(ctx, row.id)
  return toTerm(row, Math.max(ancestry.length - 1, 0), await store.terms.usage(ctx, row.id))
}

function toVocabulary(row: VocabularyRow): Vocabulary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    contentTypes: row.contentTypes,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toTerm(row: TermRow, depth: number, usage: number): Term {
  return {
    id: row.id,
    vocabularyId: row.vocabularyId,
    parentId: row.parentId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sortOrder,
    depth,
    usage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}
