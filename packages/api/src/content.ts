import * as z from 'zod/mini'

/**
 * Fields the three content types share.
 *
 * Pages, posts and products each carry a slug, a status and an SEO block, and
 * all three are checked by these rules. A slug one type accepted and another
 * refused would be a link the site cannot serve, so the rule lives in one place.
 */

/**
 * Lowercase words joined by single hyphens.
 *
 * Deliberately narrow. A slug becomes a path segment, so anything needing
 * escaping -- a space, a percent sign, a slash -- is refused rather than
 * silently mangled into one. The database only knows the slug must be unique;
 * this is where a bad one gets a reason.
 */
export const CONTENT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const contentSlugSchema = z
  .string()
  .check(z.minLength(1), z.maxLength(80), z.regex(CONTENT_SLUG_PATTERN))

export const contentStatusSchema = z.enum(['draft', 'published'])

export type ContentStatus = z.infer<typeof contentStatusSchema>

/**
 * How a list may be ordered.
 *
 * Declared here, in the wire contract, because these are query-parameter values
 * before they are SQL: the admin builds its choices from this list and the
 * handlers validate against it. `@typeky/db` declares the same union for the
 * repository's own query type -- neither package may import the other's, so the
 * handlers are where the two meet, and a divergence shows up as a type error
 * there rather than as a list that silently sorts by something else.
 */
export const CONTENT_SORTS = ['published', 'updated', 'created', 'title', 'order'] as const
export const SORT_DIRECTIONS = ['asc', 'desc'] as const

export type ContentSort = (typeof CONTENT_SORTS)[number]
export type SortDirection = (typeof SORT_DIRECTIONS)[number]

/**
 * Per-document overrides for the SEO tags.
 *
 * Every field is optional and absent means "derive it", which is not the same
 * as empty: an empty title is a title the author cleared, and the renderer has
 * to be able to tell those apart.
 */
export const seoMetadataSchema = z.object({
  title: z.optional(z.string().check(z.maxLength(120))),
  description: z.optional(z.string().check(z.maxLength(300))),
  /** A media id, resolved to a URL when the page renders. */
  ogImageMediaId: z.optional(z.string()),
  /** Overrides the canonical URL derived from the slug. */
  canonical: z.optional(z.string().check(z.maxLength(500))),
})

export type SeoMetadata = z.infer<typeof seoMetadataSchema>

/**
 * A bulk action over a list's selection.
 *
 * One request for many rows rather than one per row: a list of a hundred is a
 * hundred round trips otherwise, and the point of the button is that it does not
 * matter how many are selected.
 *
 * The cap is deliberate. A selection larger than this is a mistake or an
 * accident, and refusing it early is cheaper than doing the work and then
 * discovering it.
 */
export const BULK_ACTIONS = ['publish', 'draft', 'delete'] as const

export const bulkRequestSchema = z.object({
  ids: z.array(z.string()).check(z.minLength(1), z.maxLength(100)),
  action: z.enum(BULK_ACTIONS),
})

export type BulkAction = (typeof BULK_ACTIONS)[number]
export type BulkRequest = z.infer<typeof bulkRequestSchema>

/**
 * What a bulk action answers with.
 *
 * The count rather than a bare 204: the selection is made in a browser and can
 * be stale, and "3 of 5 changed" is something an operator can act on.
 */
export const bulkResultSchema = z.object({
  action: z.enum(BULK_ACTIONS),
  requested: z.number(),
  changed: z.number(),
})

export type BulkResult = z.infer<typeof bulkResultSchema>
