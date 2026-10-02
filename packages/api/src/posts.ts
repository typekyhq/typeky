import * as z from 'zod/mini'
import { getBlocksSchema } from './blocks'
import { contentSlugSchema, contentStatusSchema, seoMetadataSchema } from './content'

/**
 * The post resource.
 *
 * Two shapes rather than one. The list answers with a summary and the editor
 * answers with the whole document, because a body is Block JSON and a page of
 * twenty of them is a megabyte of JSON for a screen that shows titles.
 *
 * Built on first use, like the block schemas and for the same reason: these pull
 * in the block validator, and this module is imported by the site Worker as well
 * as the admin whether or not either parses a post.
 */

function build() {
  const blocks = getBlocksSchema()

  const write = z.object({
    title: z.string().check(z.minLength(1), z.maxLength(200)),
    slug: contentSlugSchema,
    excerpt: z.optional(z.nullable(z.string().check(z.maxLength(400)))),
    coverMediaId: z.optional(z.nullable(z.string())),
    blocks: z.optional(blocks),
    tags: z.optional(z.array(z.string().check(z.minLength(1), z.maxLength(60))).check(z.maxLength(20))),
    category: z.optional(z.nullable(z.string().check(z.maxLength(60)))),
    seo: z.optional(seoMetadataSchema),
    status: z.optional(contentStatusSchema),
  })

  const summary = z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    excerpt: z.nullable(z.string()),
    category: z.nullable(z.string()),
    tags: z.array(z.string()),
    status: contentStatusSchema,
    revision: z.number(),
    /** ISO 8601 UTC, or null while it is a draft. */
    publishedAt: z.nullable(z.string()),
    updatedAt: z.string(),
  })

  const response = z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    excerpt: z.nullable(z.string()),
    coverMediaId: z.nullable(z.string()),
    blocks,
    tags: z.array(z.string()),
    category: z.nullable(z.string()),
    seo: seoMetadataSchema,
    status: contentStatusSchema,
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

export function getPostWriteSchema() {
  return schemas().write
}

export function getPostSummarySchema() {
  return schemas().summary
}

export function getPostResponseSchema() {
  return schemas().response
}

export function getPostListResponseSchema() {
  return schemas().list
}

export type PostWrite = z.infer<ReturnType<typeof getPostWriteSchema>>
export type PostSummary = z.infer<ReturnType<typeof getPostSummarySchema>>
export type PostResponse = z.infer<ReturnType<typeof getPostResponseSchema>>
export type PostListResponse = z.infer<ReturnType<typeof getPostListResponseSchema>>

/** The status of a write whose status was omitted, which the repository also applies. */
export const DEFAULT_POST_STATUS = 'draft'

/** The body of the publish/unpublish action, which changes nothing else. */
export const postStatusRequestSchema = z.object({ status: contentStatusSchema })
