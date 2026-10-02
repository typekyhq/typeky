import { type Editor, useEditorState } from '@tiptap/react'

/**
 * Inserting and switching blocks.
 *
 * Deliberately plain: one button per block type, which is what makes all nine
 * reachable. Splitting, merging, dragging and a slash menu are a later concern
 * and will not change this list.
 *
 * Node and mark names come from `schema.ts`; anything StarterKit provides is
 * toggled, anything of ours is inserted.
 */

interface BlockAction {
  label: string
  isActive: (editor: Editor) => boolean
  run: (editor: Editor) => void
}

export const BLOCK_ACTIONS: BlockAction[] = [
  {
    label: 'Paragraph',
    isActive: (editor) => editor.isActive('paragraph'),
    run: (editor) => editor.chain().focus().setParagraph().run(),
  },
  ...[2, 3, 4].map((level) => ({
    label: `Heading ${level}`,
    isActive: (editor: Editor) => editor.isActive('heading', { level }),
    run: (editor: Editor) => editor.chain().focus().toggleHeading({ level: level as 2 | 3 | 4 }).run(),
  })),
  {
    label: 'Bulleted list',
    isActive: (editor) => editor.isActive('bulletList'),
    run: (editor) => editor.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered list',
    isActive: (editor) => editor.isActive('orderedList'),
    run: (editor) => editor.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'Quote',
    isActive: (editor) => editor.isActive('blockquote'),
    run: (editor) => editor.chain().focus().toggleBlockquote().run(),
  },
  {
    label: 'Code',
    isActive: (editor) => editor.isActive('codeBlock'),
    run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  },
  {
    label: 'Divider',
    isActive: (editor) => editor.isActive('horizontalRule'),
    run: (editor) => editor.chain().focus().setHorizontalRule().run(),
  },
  {
    label: 'Image',
    isActive: (editor) => editor.isActive('image'),
    run: (editor) => editor.chain().focus().setImage().run(),
  },
  {
    label: 'Video',
    isActive: (editor) => editor.isActive('video'),
    run: (editor) => editor.chain().focus().setVideo().run(),
  },
  {
    label: 'Call to action',
    isActive: (editor) => editor.isActive('cta'),
    run: (editor) => editor.chain().focus().setCta().run(),
  },
]

export function EditorToolbar({ editor }: { editor: Editor }) {
  // Only the toolbar re-renders when the selection moves. Re-rendering the whole
  // editor on every transaction is the old behaviour and is off by default.
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => BLOCK_ACTIONS.map((action) => action.isActive(current)),
  })

  return (
    <div role="toolbar" aria-label="Blocks" className="flex flex-wrap gap-1 border-b p-2">
      {BLOCK_ACTIONS.map((action, index) => (
        <button
          key={action.label}
          type="button"
          // aria-pressed rather than a class, so the state is available to
          // assistive technology and to tests.
          aria-pressed={active[index] ?? false}
          className={`rounded border px-2 py-1 text-xs ${
            active[index] === true
              ? 'border-neutral-400 bg-neutral-200 font-medium text-neutral-900'
              : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
          }`}
          onClick={() => action.run(editor)}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
