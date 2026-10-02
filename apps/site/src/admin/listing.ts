import {
  BULK_ACTIONS,
  bulkRequestSchema,
  type BulkAction,
  type BulkRequest,
} from '@typeky/api'
import type { ContentSort, ListQuery, SortDirection, Repositories } from '@typeky/db'
import type { Context } from 'hono'
import { apiError, readJsonBody, type AdminEnv } from './errors'

/**
 * The parts every content list shares.
 *
 * Filtering, searching, sorting and paging are the same on all three lists, and
 * the three handlers were beginning to say so three times. More to the point,
 * the sort key is the one request value that reaches SQL, so having exactly one
 * place that validates it is worth more than the lines it saves.
 */

/** A search longer than this is a mistake, and truncating is kinder than refusing. */
const MAX_SEARCH_LENGTH = 200

/** The sort keys a list may ask for. */
const SORTS: readonly ContentSort[] = ['published', 'updated', 'created', 'title', 'order']

export type ListQueryResult = { ok: true; query: ListQuery } | { ok: false; message: string }

/**
 * Reads the list query out of the URL.
 *
 * Unknown values are refused rather than ignored for `status` and `direction`,
 * because both are closed sets the UI only sends itself; `sort` falls back,
 * because a bookmarked URL with a sort this version no longer offers should
 * still show a list.
 */
export function readListQuery(c: Context<AdminEnv>): ListQueryResult {
  const status = c.req.query('status')
  if (status !== undefined && status !== '' && status !== 'draft' && status !== 'published') {
    return { ok: false, message: 'status must be draft or published' }
  }

  const direction = c.req.query('direction')
  if (direction !== undefined && direction !== '' && direction !== 'asc' && direction !== 'desc') {
    return { ok: false, message: 'direction must be asc or desc' }
  }

  const sort = c.req.query('sort')
  const search = c.req.query('search')?.slice(0, MAX_SEARCH_LENGTH)
  const limit = toInteger(c.req.query('limit'))
  const offset = toInteger(c.req.query('offset'))

  return {
    ok: true,
    query: {
      ...(status === 'draft' || status === 'published' ? { status } : {}),
      ...(search === undefined || search.trim() === '' ? {} : { search }),
      ...(sort !== undefined && (SORTS as readonly string[]).includes(sort)
        ? { sort: sort as ContentSort }
        : {}),
      ...(direction === 'asc' || direction === 'desc' ? { direction: direction as SortDirection } : {}),
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset }),
    },
  }
}

/** A repository that can act on many rows at once. */
export interface BulkTarget {
  updateMany(ctx: never, ids: string[], change: { status: 'draft' | 'published' }): Promise<number>
  removeMany(ctx: never, ids: string[]): Promise<number>
}

/**
 * Applies one action to the selected rows and answers how many it reached.
 *
 * The count is the answer rather than a plain 204 because the selection is made
 * in a browser and can be stale: somebody else may have deleted one of these
 * rows, and "3 of 5 changed" is information the operator can act on.
 */
export async function runBulk(
  c: Context<AdminEnv>,
  repositories: (env: AdminEnv['Bindings']) => Repositories | null,
  pick: (store: Repositories) => BulkTarget,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = bulkRequestSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) {
    return apiError(c, 'invalid_request', `expected an ids list and one of: ${BULK_ACTIONS.join(', ')}`)
  }

  const { ids, action } = parsed.data as BulkRequest
  const target = pick(store)
  const context = undefined as never

  const changed =
    action === 'delete'
      ? await target.removeMany(context, ids)
      : await target.updateMany(context, ids, { status: action === 'publish' ? 'published' : 'draft' })

  return c.json({ action: action satisfies BulkAction, requested: ids.length, changed })
}

function toInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined
}
