import * as z from 'zod/mini'
import { contentStatusSchema } from './content'

/**
 * The dashboard's one answer.
 *
 * One request rather than a handful of list calls: a screen whose job is to summarise
 * three collections should not spend four round trips finding out how many rows each
 * has, and the counts are counts -- there is nothing to page through.
 *
 * The three kinds are named here rather than inferred, because a dashboard is where
 * "what does this site have" is asked, and adding a content type should be a change
 * in one place that says so.
 */

export const OVERVIEW_KINDS = ['page', 'post', 'product'] as const

export type OverviewKind = (typeof OVERVIEW_KINDS)[number]

export const overviewCountSchema = z.object({
  published: z.number(),
  draft: z.number(),
})

export type OverviewCount = z.infer<typeof overviewCountSchema>

export const overviewItemSchema = z.object({
  id: z.string(),
  kind: z.enum(OVERVIEW_KINDS),
  title: z.string(),
  status: contentStatusSchema,
  /** When it was last written, which is what a draft list is ordered by. */
  updatedAt: z.string(),
  /** Null while it is a draft. */
  publishedAt: z.nullable(z.string()),
})

export type OverviewItem = z.infer<typeof overviewItemSchema>

export const overviewResponseSchema = z.object({
  counts: z.object({
    page: overviewCountSchema,
    post: overviewCountSchema,
    product: overviewCountSchema,
    /** Media has no draft state; the number is all of it. */
    media: z.number(),
  }),
  /** The most recently written drafts, newest first. */
  drafts: z.array(overviewItemSchema),
  /** What went live most recently, or null when nothing ever has. */
  lastPublished: z.nullable(overviewItemSchema),
})

export type OverviewResponse = z.infer<typeof overviewResponseSchema>
