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
