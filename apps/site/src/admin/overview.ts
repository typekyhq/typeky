import {
  type OverviewCount,
  type OverviewItem,
  type OverviewKind,
  type OverviewResponse,
} from '@typeky/api'
import { defaultContext, type Repositories } from '@typeky/db'
import type { Context } from 'hono'
import { apiError, type AdminEnv, type RepositoryResolver } from './errors'

/**
 * The dashboard.
 *
 * Counts and two short lists, in one request. The alternative -- the screen calling
 * each list endpoint for each status -- is four round trips to learn four numbers,
 * and a dashboard that is slow to open is one nobody opens.
 *
 * What it deliberately does not do is invent a metric. "Publish rate this week" and
 * "traffic" are not here because the first would be a number nobody acts on and the
 * second is not the platform's to know.
 */

/** How many drafts the dashboard names before it stops listing them. */
const DRAFT_LIMIT = 5

interface KindReader {
  kind: OverviewKind
  /** Rows of this kind, with the fields every content type shares. */
  list: (query: {
    status?: 'draft' | 'published'
    sort?: 'published' | 'updated'
    direction?: 'asc' | 'desc'
    limit?: number
  }) => Promise<{ items: Shape[]; total: number }>
}

/** What the three kinds have in common, which is all the dashboard reads. */
interface Shape {
  id: string
  title: string
  status: 'draft' | 'published'
  updatedAt: Date
  publishedAt: Date | null
}

function readers(store: Repositories): readonly [KindReader, KindReader, KindReader] {
  const ctx = defaultContext()

  return [
    { kind: 'page', list: (query) => store.pages.list(ctx, query) },
    { kind: 'post', list: (query) => store.posts.list(ctx, query) },
    { kind: 'product', list: (query) => store.products.list(ctx, query) },
  ]
}

function toItem(kind: OverviewKind, row: Shape): OverviewItem {
  return {
    id: row.id,
    kind,
    title: row.title,
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null,
  }
}

/** Newest first, with a title tie-break so two rows written in one millisecond hold still. */
function byUpdatedDesc(left: OverviewItem, right: OverviewItem): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? 1 : -1
  return left.title.localeCompare(right.title)
}

export async function readOverview(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const [pages, posts, products] = readers(store)
  const kinds = [pages, posts, products] as const

  /**
   * Published and draft, counted in two queries per kind rather than one.
   *
   * The repository answers a total for whatever it was asked for, so "all" minus
   * "drafts" is published -- and asking for one row of each is what makes it a count
   * rather than a read.
   */
  async function count(reader: KindReader): Promise<OverviewCount> {
    const all = await reader.list({ limit: 1 })
    const drafts = await reader.list({ status: 'draft', limit: 1 })

    return { published: all.total - drafts.total, draft: drafts.total }
  }

  const [page, post, product, media] = await Promise.all([
    count(pages),
    count(posts),
    count(products),
    store.media.list(defaultContext(), { limit: 1 }),
  ])

  // Each kind is asked for its own most recent drafts and merged here: the
  // repository sorts inside one table, and "the drafts I should look at" does not
  // know which table a row came from.
  const perKindDrafts = await Promise.all(
    kinds.map(async (reader: KindReader) => {
      const result = await reader.list({ status: 'draft', sort: 'updated', direction: 'desc', limit: DRAFT_LIMIT })
      return result.items.map((row) => toItem(reader.kind, row))
    }),
  )
  const drafts = perKindDrafts.flat().sort(byUpdatedDesc).slice(0, DRAFT_LIMIT)

  const perKindPublished = await Promise.all(
    kinds.map(async (reader: KindReader) => {
      const result = await reader.list({
        status: 'published',
        sort: 'published',
        direction: 'desc',
        limit: 1,
      })
      const newest = result.items[0]
      return newest === undefined ? null : toItem(reader.kind, newest)
    }),
  )
  const published = perKindPublished
    .filter((item): item is OverviewItem => item !== null)
    .sort((left, right) => (left.publishedAt ?? '') < (right.publishedAt ?? '') ? 1 : -1)
  const lastPublished = published[0] ?? null

  const body: OverviewResponse = {
    counts: { page, post, product, media: media.total },
    drafts,
    lastPublished,
  }

  return c.json(body)
}
