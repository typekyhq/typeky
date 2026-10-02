import type { Block } from '@typeky/core'
import * as z from 'zod/mini'

/**
 * Block JSON validation.
 *
 * The types live in `@typeky/core` so the site side can use them without a
 * validator; the schema lives here so the API and the admin can parse with it.
 * The two are held together by `parseBlocks` at the bottom, whose return type
 * makes a divergence a compile error rather than a runtime surprise.
 *
 * The schemas are built on first use rather than at module scope. A
 * module-scope schema is an import-time side effect, and this module is pulled
 * into the site Worker and the admin SPA whether or not either parses a block;
 * building on demand keeps the module free of side effects so a bundler can drop
 * it outright, which is what it does.
 */

export type BlockSchema = z.ZodMiniType<Block>
export type BlocksSchema = z.ZodMiniType<Block[]>

interface Schemas {
  block: BlockSchema
  blocks: BlocksSchema
}

let built: Schemas | undefined

function build(): Schemas {
  const markSchema = z.object({
    type: z.enum(['bold', 'italic', 'code', 'link']),
    href: z.optional(z.string().check(z.maxLength(2048))),
  })

  const inlineSchema = z.array(
    z.union([
      z.object({
        type: z.literal('text'),
        text: z.string(),
        marks: z.optional(z.array(markSchema).check(z.maxLength(8))),
      }),
      z.object({ type: z.literal('hardBreak') }),
    ]),
  )

  // Written out rather than derived from HEADING_LEVELS: `z.union` wants a
  // tuple, and `parseBlocks` at the bottom is what catches the two drifting.
  const headingLevelSchema = z.union([z.literal(2), z.literal(3), z.literal(4)])

  const paragraphSchema = z.object({ type: z.literal('paragraph'), content: inlineSchema })

  const headingSchema = z.object({
    type: z.literal('heading'),
    level: headingLevelSchema,
    content: inlineSchema,
  })

  const codeSchema = z.object({
    type: z.literal('code'),
    language: z.nullable(z.string()),
    code: z.string(),
  })

  const imageSchema = z.object({
    type: z.literal('image'),
    mediaId: z.string(),
    alt: z.nullable(z.string()),
  })

  const videoSchema = z.object({
    type: z.literal('video'),
    mediaId: z.string(),
    title: z.nullable(z.string()),
  })

  const dividerSchema = z.object({ type: z.literal('divider') })

  const ctaSchema = z.object({
    type: z.literal('cta'),
    title: z.string(),
    body: z.string(),
    label: z.string(),
    href: z.string(),
  })

  // A list item and a quotation both hold blocks, so their schemas are
  // recursive. TypeScript needs the recursive name declared before it is
  // defined, and a validator cannot describe its own shape.
  let blockSchema!: BlockSchema

  const listItemSchema = z.object({
    content: inlineSchema,
    children: z.array(z.lazy(() => blockSchema)),
  })

  const listSchema = z.object({
    type: z.literal('list'),
    ordered: z.boolean(),
    items: z.array(listItemSchema),
  })

  const quoteSchema = z.object({
    type: z.literal('quote'),
    content: z.array(z.lazy(() => blockSchema)),
  })

  blockSchema = z.lazy(() =>
    z.union([
      paragraphSchema,
      headingSchema,
      listSchema,
      quoteSchema,
      codeSchema,
      imageSchema,
      videoSchema,
      dividerSchema,
      ctaSchema,
    ]),
  )

  built = { block: blockSchema, blocks: z.array(blockSchema) }
  return built
}

/** For composing into a larger schema, as the content endpoints do. */
export function getBlocksSchema(): BlocksSchema {
  return (built ?? build()).blocks
}

export function getBlockSchema(): BlockSchema {
  return (built ?? build()).block
}

/**
 * Parse a stored body.
 *
 * The declared return type is the whole point: if the schema and
 * `@typeky/core`'s `Block` union stop agreeing, this stops compiling.
 */
export function parseBlocks(value: unknown): Block[] {
  return getBlocksSchema().parse(value)
}

/** For input that may be anything at all; null instead of a thrown error. */
export function safeParseBlocks(value: unknown): Block[] | null {
  const parsed = getBlocksSchema().safeParse(value)
  return parsed.success ? parsed.data : null
}
