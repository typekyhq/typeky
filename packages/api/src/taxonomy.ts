import * as z from 'zod/mini'
import { contentSlugSchema } from './content'

/**
 * Vocabularies and terms -- the taxonomy, the Drupal way.
 *
 * A vocabulary is a named container of terms; a vocabulary says which content
 * types may draw from it; a term may sit under a parent, which is what makes a
 * vocabulary a tree. A piece of content carries any number of terms.
 *
 * The tree is flat on the wire. Every term arrives with its `depth`, and the
 * admin indents by it, which keeps the contract a list of rows rather than a
 * recursive object: a schema that describes itself is one both sides must agree
 * about on parsing, and a list of depths is one integer.
 */

export const TAXONOMY_CONTENT_TYPES = ['post', 'product'] as const

export type TaxonomyContentType = (typeof TAXONOMY_CONTENT_TYPES)[number]

export const vocabularySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.nullable(z.string()),
  /** The content types allowed to draw from it. Empty means none yet. */
  contentTypes: z.array(z.enum(TAXONOMY_CONTENT_TYPES)),
  sortOrder: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Vocabulary = z.infer<typeof vocabularySchema>

/**
 * A vocabulary being created or renamed.
 *
 * No `slug`: a vocabulary is a container, not a URL. Only a term becomes a path
 * segment, which is why only a term has one.
 */
export const vocabularyWriteSchema = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(80)),
  description: z.optional(z.nullable(z.string().check(z.maxLength(500)))),
  contentTypes: z.optional(z.array(z.enum(TAXONOMY_CONTENT_TYPES))),
})

export type VocabularyWrite = z.infer<typeof vocabularyWriteSchema>

/**
 * A term as a piece of content carries it.
 *
 * Smaller than `termSchema` on purpose: a list of posts shows the names, and
 * `depth` and `usage` are facts about the tree rather than about this post.
 */
export const termRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
})

export type TermRef = z.infer<typeof termRefSchema>

export const termSchema = z.object({
  id: z.string(),
  vocabularyId: z.string(),
  /** Null for a root term. */
  parentId: z.nullable(z.string()),
  name: z.string(),
  slug: z.string(),
  description: z.nullable(z.string()),
  sortOrder: z.number(),
  /** Distance from the root, so the admin can indent without walking parents. */
  depth: z.number(),
  /**
   * How much content carries this term.
   *
   * On the term rather than behind its own request because the tree wants it on
   * every row anyway: this is what a delete confirmation has to say, and asking
   * per row would be one request per term.
   */
  usage: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type Term = z.infer<typeof termSchema>

export const termWriteSchema = z.object({
  vocabularyId: z.string().check(z.minLength(1)),
  parentId: z.optional(z.nullable(z.string())),
  name: z.string().check(z.minLength(1), z.maxLength(80)),
  slug: contentSlugSchema,
  description: z.optional(z.nullable(z.string().check(z.maxLength(500)))),
})

export type TermWrite = z.infer<typeof termWriteSchema>

/**
 * Everything the taxonomy screen needs, in one answer.
 *
 * One request rather than one per vocabulary: a site has a handful of these, and
 * a screen that fetched as you clicked would show a spinner between two halves
 * of the same list.
 */
export const taxonomyResponseSchema = z.object({
  vocabularies: z.array(vocabularySchema),
  /** Every term of every vocabulary, depth first inside its vocabulary. */
  terms: z.array(termSchema),
})

export type TaxonomyResponse = z.infer<typeof taxonomyResponseSchema>
