import * as z from 'zod/mini'
import { getBlocksSchema } from './blocks'
import { contentSlugSchema, contentStatusSchema, seoMetadataSchema } from './content'
import { termRefSchema } from './taxonomy'

/**
 * The product resource.
 *
 * A showcase product rather than a store item: the price is a label, and the
 * call to action is a link out to wherever the sale actually happens. CE has no
 * orders and no payment, which is why `priceLabel` is text -- "From $20/mo" is
 * something a template can print, and a number here would promise arithmetic the
 * platform does not do.
 *
 * The gallery holds media ids, not URLs. A URL written into a product would
 * break the day the storage layout changes, and it would leave the renderer
 * unable to tell an image from anything else.
 *
 * Built on first use, like the other content schemas, because these pull in the
 * block validator.
 */

const MEDIA_ID = z.string().check(z.minLength(1), z.maxLength(120))

function build() {
  const blocks = getBlocksSchema()

  const spec = z.object({
    label: z.string().check(z.minLength(1), z.maxLength(60)),
    value: z.string().check(z.minLength(1), z.maxLength(200)),
  })

  const write = z.object({
    title: z.string().check(z.minLength(1), z.maxLength(200)),
    slug: contentSlugSchema,
    summary: z.optional(z.nullable(z.string().check(z.maxLength(400)))),
    blocks: z.optional(blocks),
    coverMediaId: z.optional(z.nullable(MEDIA_ID)),
    gallery: z.optional(z.array(MEDIA_ID).check(z.maxLength(24))),
    specs: z.optional(z.array(spec).check(z.maxLength(24))),
    priceLabel: z.optional(z.nullable(z.string().check(z.maxLength(60)))),
    ctaLabel: z.optional(z.nullable(z.string().check(z.maxLength(40)))),
    ctaUrl: z.optional(z.nullable(z.string().check(z.maxLength(500)))),
    seo: z.optional(seoMetadataSchema),
    status: z.optional(contentStatusSchema),
    sortOrder: z.optional(z.number().check(z.int(), z.minimum(0), z.maximum(9999))),
    /** The terms this product carries, by id. Omitted means none. */
    termIds: z.optional(z.array(z.string()).check(z.maxLength(50))),
  })

  const summary = z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    summary: z.nullable(z.string()),
    terms: z.array(termRefSchema),
    priceLabel: z.nullable(z.string()),
    status: contentStatusSchema,
    sortOrder: z.number(),
    revision: z.number(),
    publishedAt: z.nullable(z.string()),
    updatedAt: z.string(),
  })

  const response = z.object({
    id: z.string(),
    title: z.string(),
    slug: z.string(),
    summary: z.nullable(z.string()),
    blocks,
    coverMediaId: z.nullable(z.string()),
    gallery: z.array(z.string()),
    specs: z.array(spec),
    priceLabel: z.nullable(z.string()),
    ctaLabel: z.nullable(z.string()),
    ctaUrl: z.nullable(z.string()),
    terms: z.array(termRefSchema),
    seo: seoMetadataSchema,
    status: contentStatusSchema,
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

export function getProductWriteSchema() {
  return schemas().write
}

export function getProductSummarySchema() {
  return schemas().summary
}

export function getProductResponseSchema() {
  return schemas().response
}

export function getProductListResponseSchema() {
  return schemas().list
}

export type ProductWrite = z.infer<ReturnType<typeof getProductWriteSchema>>
export type ProductSummary = z.infer<ReturnType<typeof getProductSummarySchema>>
export type ProductResponse = z.infer<ReturnType<typeof getProductResponseSchema>>
export type ProductListResponse = z.infer<ReturnType<typeof getProductListResponseSchema>>

/** One row of the specification table, as the write shape carries it. */
export type ProductSpec = NonNullable<ProductWrite['specs']>[number]
