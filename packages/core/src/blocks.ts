/**
 * Block JSON: the stored form of a page, post or product body.
 *
 * The site never sees the editor's document model. Content is written as this,
 * rendered by `blockToHtml` (which lives beside this file and is likewise
 * dependency-free), and turned back into an editable document by the admin.
 * Keeping the spec here is what lets both sides agree on it without the site
 * Worker pulling React in (architecture section 3.11).
 *
 * Two rules run through the whole file:
 *   - media is referenced by id, never by URL, so content does not break when a
 *     storage key or a public URL changes;
 *   - anything the theme has to lay out is data, not markup.
 */

export const HEADING_LEVELS = [2, 3, 4] as const

export type HeadingLevel = (typeof HEADING_LEVELS)[number]

export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'list',
  'quote',
  'code',
  'image',
  'video',
  'divider',
  'cta',
] as const

export type BlockType = (typeof BLOCK_TYPES)[number]

/* ------------------------------------------------------------- inline -- */

export type InlineMarkType = 'bold' | 'italic' | 'code' | 'link'

export interface InlineMark {
  type: InlineMarkType
  /** Only meaningful on a link. */
  href?: string
}

export type InlineNode =
  | { type: 'text'; text: string; marks?: InlineMark[] }
  /** A hard break inside a run of text. */
  | { type: 'hardBreak' }

/** The text of one paragraph, heading or list item. */
export type InlineContent = InlineNode[]

/* -------------------------------------------------------------- blocks -- */

export interface ParagraphBlock {
  type: 'paragraph'
  content: InlineContent
}

export interface HeadingBlock {
  type: 'heading'
  level: HeadingLevel
  content: InlineContent
}

/**
 * A quotation.
 *
 * Holds blocks rather than a single run of text because a quotation can contain
 * several paragraphs, and a model that flattened them would lose the paragraph
 * breaks on the way back into the editor.
 */
export interface QuoteBlock {
  type: 'quote'
  content: Block[]
}

export interface ListItem {
  /** The item's own text. ProseMirror guarantees at least one paragraph. */
  content: InlineContent
  /** Anything after that paragraph: further paragraphs, nested lists. */
  children: Block[]
}

export interface ListBlock {
  type: 'list'
  ordered: boolean
  items: ListItem[]
}

export interface CodeBlock {
  type: 'code'
  /** Absent when the author did not pick one. */
  language: string | null
  code: string
}

export interface ImageBlock {
  type: 'image'
  /** Media id, resolved to a URL at render time. */
  mediaId: string
  alt: string | null
}

export interface VideoBlock {
  type: 'video'
  mediaId: string
  title: string | null
}

export interface DividerBlock {
  type: 'divider'
}

export interface CtaBlock {
  type: 'cta'
  title: string
  body: string
  label: string
  href: string
}

export type Block =
  | ParagraphBlock
  | HeadingBlock
  | ListBlock
  | QuoteBlock
  | CodeBlock
  | ImageBlock
  | VideoBlock
  | DividerBlock
  | CtaBlock
