import * as z from 'zod/mini'
import { getBlocksSchema } from './blocks'
import { contentSlugSchema, contentStatusSchema, seoMetadataSchema } from './content'

/**
 * The page resource.
 *
 * A page carries a body, a slug and a status like a post, and additionally
 * whether it is the site's home page and where it sorts.
 *
 * `is_home` is absent from the write shape on purpose. The database allows at
 * most one home page through a partial unique index, so it is changed through
 * its own action rather than as a field: a form that posted a whole document
 * including this flag could clear the current home page or collide with it
 * depending on the order the fields happened to be written in.
 *
 * Built on first use, like the post schemas, because these pull in the block
 * validator.
 */

function build() {
  const blocks = getBlocksSchema()

  const write = z.object({
    title: z.string().check(z.minLength(1), z.maxLength(200)),
    slug: contentSlugSchema,
    blocks: z.optional(blocks),
    seo: z.optional(seoMetadataSchema),
    status: z.optional(contentStatusSchema),
    /** Lower sorts first. Ties fall back to creation order. */
    sortOrder: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(9999))),
  })

  const summary = z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    status: contentStatusSchema,
    isHome: z.boolean(),
    sortOrder: z.number(),
    revision: z.number(),
    publishedAt: z.nullable(z.string()),
    updatedAt: z.string(),
  })

  const response = z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    blocks,
    seo: seoMetadataSchema,
    status: contentStatusSchema,
    isHome: z.boolean(),
    sortOrder: z.number(),
    revision: z.number(),
    publishedAt: z.nullable(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  })

  const list = z.object({
    items: z.array(summary),
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  })

  return { write, summary, response, list }
}

let built: ReturnType<typeof build> | undefined

function schemas(): ReturnType<typeof build> {
  built ??= build()
  return built
}

export function getPageWriteSchema() {
  return schemas().write
}

export function getPageSummarySchema() {
  return schemas().summary
}

export function getPageResponseSchema() {
  return schemas().response
}

export function getPageListResponseSchema() {
  return schemas().list
}

export type PageWrite = z.infer<ReturnType<typeof getPageWriteSchema>>
export type PageSummary = z.infer<ReturnType<typeof getPageSummarySchema>>
export type PageResponse = z.infer<ReturnType<typeof getPageResponseSchema>>
export type PageListResponse = z.infer<ReturnType<typeof getPageListResponseSchema>>
