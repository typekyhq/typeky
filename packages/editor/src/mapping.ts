import type {
  Block,
  HeadingLevel,
  InlineContent,
  InlineMark,
  InlineNode,
  ListItem,
} from '@typeky/core'
import type { JSONContent } from '@tiptap/core'

/**
 * The only conversion between the editor's document model and the stored form.
 *
 * ProseMirror's JSON never leaves the admin: content is stored as Block JSON,
 * rendered by `blockToHtml`, and turned back into a document here. One conversion
 * point is what keeps the two representations from drifting into a shape that
 * only round-trips in one direction (architecture section 3.11).
 *
 * Where the two models differ:
 *   - ProseMirror spells a list across two node types, the stored form has one
 *     with an `ordered` flag;
 *   - ProseMirror spells a divider as `horizontalRule`;
 *   - a list item is a paragraph plus whatever follows it, which the stored form
 *     splits into `content` and `children` so the common case stays flat.
 */

const MARK_TYPES: ReadonlySet<string> = new Set(['bold', 'italic', 'code', 'link'])

interface ProseMirrorMark {
  type: string
  attrs?: Record<string, unknown>
}

/* ------------------------------------------------- editor -> storage -- */

export function toBlockJSON(document: JSONContent): Block[] {
  return toBlocks(document.content)
}

function toBlocks(nodes: readonly JSONContent[] | undefined): Block[] {
  const blocks: Block[] = []

  for (const node of nodes ?? []) {
    const block = toBlock(node)
    if (block !== null) blocks.push(block)
  }

  return blocks
}

function toBlock(node: JSONContent): Block | null {
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', content: toInline(node.content) }

    case 'heading':
      return { type: 'heading', level: toHeadingLevel(node.attrs?.level), content: toInline(node.content) }

    case 'bulletList':
      return { type: 'list', ordered: false, items: toListItems(node) }

    case 'orderedList':
      return { type: 'list', ordered: true, items: toListItems(node) }

    case 'blockquote':
      return { type: 'quote', content: toBlocks(node.content) }

    case 'codeBlock':
      return {
        type: 'code',
        language: typeof node.attrs?.language === 'string' ? node.attrs.language : null,
        code: textOf(node),
      }

    case 'horizontalRule':
      return { type: 'divider' }

    case 'image':
      return {
        type: 'image',
        mediaId: stringAttribute(node.attrs?.mediaId),
        alt: nullableString(node.attrs?.alt),
      }

    case 'video':
      return {
        type: 'video',
        mediaId: stringAttribute(node.attrs?.mediaId),
        title: nullableString(node.attrs?.title),
      }

    case 'cta':
      return {
        type: 'cta',
        title: stringAttribute(node.attrs?.title),
        body: stringAttribute(node.attrs?.body),
        label: stringAttribute(node.attrs?.label),
        href: stringAttribute(node.attrs?.href),
      }

    default:
      // An unknown node is dropped rather than guessed at. The schema only
      // permits the nine above, so this means a node was added without teaching
      // the mapping about it.
      return null
  }
}

function toListItems(node: JSONContent): ListItem[] {
  return (node.content ?? []).map((item) => {
    const blocks = toBlocks(item.content)
    const [first, ...rest] = blocks

    return first?.type === 'paragraph'
      ? { content: first.content, children: rest }
      : { content: [], children: blocks }
  })
}

function toInline(nodes: readonly JSONContent[] | undefined): InlineContent {
  const content: InlineNode[] = []

  for (const node of nodes ?? []) {
    if (node.type === 'hardBreak') {
      content.push({ type: 'hardBreak' })
      continue
    }

    if (node.type !== 'text') continue

    const marks = toMarks(node.marks)
    content.push({ type: 'text', text: node.text ?? '', ...(marks.length === 0 ? {} : { marks }) })
  }

  return content
}

function toMarks(marks: readonly ProseMirrorMark[] | undefined): InlineMark[] {
  const converted: InlineMark[] = []

  for (const mark of marks ?? []) {
    if (!MARK_TYPES.has(mark.type)) continue

    if (mark.type === 'link') {
      const href = mark.attrs?.href
      converted.push(typeof href === 'string' ? { type: 'link', href } : { type: 'link' })
    } else {
      converted.push({ type: mark.type as InlineMark['type'] })
    }
  }

  return converted
}

/* ------------------------------------------------- storage -> editor -- */

export function fromBlockJSON(blocks: Block[]): JSONContent {
  return { type: 'doc', content: blocks.map(fromBlock) }
}

function fromBlock(block: Block): JSONContent {
  switch (block.type) {
    case 'paragraph':
      return { type: 'paragraph', content: fromInline(block.content) }

    case 'heading':
      return { type: 'heading', attrs: { level: block.level }, content: fromInline(block.content) }

    case 'list':
      return {
        type: block.ordered ? 'orderedList' : 'bulletList',
        content: block.items.map(fromListItem),
      }

    case 'quote':
      return { type: 'blockquote', content: block.content.map(fromBlock) }

    case 'code':
      // A text node cannot be empty, so an empty code block has no content.
      return {
        type: 'codeBlock',
        attrs: { language: block.language },
        content: block.code === '' ? [] : [{ type: 'text', text: block.code }],
      }

    case 'image':
      return { type: 'image', attrs: { mediaId: block.mediaId, alt: block.alt } }

    case 'video':
      return { type: 'video', attrs: { mediaId: block.mediaId, title: block.title } }

    case 'divider':
      return { type: 'horizontalRule' }

    case 'cta':
      return {
        type: 'cta',
        attrs: { title: block.title, body: block.body, label: block.label, href: block.href },
      }
  }
}

function fromListItem(item: ListItem): JSONContent {
  return {
    type: 'listItem',
    content: [
      // Always present: ProseMirror's listItem starts with a paragraph, and the
      // stored form keeps that paragraph in `content` rather than in `children`.
      { type: 'paragraph', content: fromInline(item.content) },
      ...item.children.map(fromBlock),
    ],
  }
}

function fromInline(content: InlineContent): JSONContent[] {
  return content.map((node) =>
    node.type === 'hardBreak'
      ? { type: 'hardBreak' }
      : {
          type: 'text',
          text: node.text,
          ...(node.marks === undefined || node.marks.length === 0 ? {} : { marks: fromMarks(node.marks) }),
        },
  )
}

function fromMarks(marks: InlineMark[]): JSONContent['marks'] {
  return marks.map((mark) =>
    mark.type === 'link'
      ? mark.href === undefined
        ? { type: 'link' }
        : { type: 'link', attrs: { href: mark.href } }
      : { type: mark.type },
  )
}

/* --------------------------------------------------------------- utils -- */

function toHeadingLevel(value: unknown): HeadingLevel {
  // The schema refuses anything else, so this is a narrowing rather than a
  // fallback: content that reached storage through the editor is already 2-4.
  return value === 3 || value === 4 ? value : 2
}

function stringAttribute(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

function textOf(node: JSONContent): string {
  return (node.content ?? []).map((child) => child.text ?? '').join('')
}
