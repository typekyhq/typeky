import type { Editor, Range } from '@tiptap/core'

/**
 * The nine block types, as something a user can pick.
 *
 * Shared by the toolbar and the slash menu so the two cannot offer different
 * things, and so adding a block type is an edit in one place.
 */

export interface BlockAction {
  label: string
  /** Extra words the slash menu matches on, since people type 'h2' or 'hr'. */
  keywords: string[]
  isActive: (editor: Editor) => boolean
  /**
   * `range` is the `/query` text the slash menu has to remove first. The toolbar
   * passes nothing, because the cursor is already where the block should go.
   */
  apply: (editor: Editor, range?: Range) => void
}

function chainFor(editor: Editor, range?: Range) {
  const chain = editor.chain().focus()
  return range === undefined ? chain : chain.deleteRange(range)
}

export const BLOCK_ACTIONS: BlockAction[] = [
  {
    label: 'Paragraph',
    keywords: ['text', 'body', 'p'],
    isActive: (editor) => editor.isActive('paragraph'),
    apply: (editor, range) => {
      chainFor(editor, range).setParagraph().run()
    },
  },
  ...[2, 3, 4].map((level) => ({
    label: `Heading ${level}`,
    keywords: [`h${level}`, 'title', 'heading'],
    isActive: (editor: Editor) => editor.isActive('heading', { level }),
    apply: (editor: Editor, range?: Range) => {
      chainFor(editor, range).setHeading({ level: level as 2 | 3 | 4 }).run()
    },
  })),
  {
    label: 'Bulleted list',
    keywords: ['ul', 'bullet', 'unordered'],
    isActive: (editor) => editor.isActive('bulletList'),
    apply: (editor, range) => {
      chainFor(editor, range).toggleBulletList().run()
    },
  },
  {
    label: 'Numbered list',
    keywords: ['ol', 'ordered', 'number'],
    isActive: (editor) => editor.isActive('orderedList'),
    apply: (editor, range) => {
      chainFor(editor, range).toggleOrderedList().run()
    },
  },
  {
    label: 'Quote',
    keywords: ['blockquote', 'citation'],
    isActive: (editor) => editor.isActive('blockquote'),
    apply: (editor, range) => {
      chainFor(editor, range).toggleBlockquote().run()
    },
  },
  {
    label: 'Code',
    keywords: ['pre', 'snippet'],
    isActive: (editor) => editor.isActive('codeBlock'),
    apply: (editor, range) => {
      chainFor(editor, range).toggleCodeBlock().run()
    },
  },
  {
    label: 'Divider',
    keywords: ['hr', 'rule', 'separator', 'line'],
    isActive: (editor) => editor.isActive('horizontalRule'),
    apply: (editor, range) => {
      chainFor(editor, range).setHorizontalRule().run()
    },
  },
  {
    label: 'Image',
    keywords: ['photo', 'picture', 'media'],
    isActive: (editor) => editor.isActive('image'),
    apply: (editor, range) => {
      chainFor(editor, range).setImage().run()
    },
  },
  {
    label: 'Video',
    keywords: ['clip', 'media'],
    isActive: (editor) => editor.isActive('video'),
    apply: (editor, range) => {
      chainFor(editor, range).setVideo().run()
    },
  },
  {
    label: 'Call to action',
    keywords: ['cta', 'banner', 'button'],
    isActive: (editor) => editor.isActive('cta'),
    apply: (editor, range) => {
      chainFor(editor, range).setCta().run()
    },
  },
]

/** Case-insensitive prefix match on the label or on a keyword. */
export function matchBlockActions(query: string): BlockAction[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return BLOCK_ACTIONS

  // Prefix rather than substring: `ul` should mean the bulleted list, not
  // everything whose keywords happen to contain those two letters somewhere.
  return BLOCK_ACTIONS.filter(
    (action) =>
      action.label.toLowerCase().startsWith(needle) ||
      action.keywords.some((keyword) => keyword.startsWith(needle)),
  )
}
