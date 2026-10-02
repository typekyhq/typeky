import type { Block } from '@typeky/core'
import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { DragHandle } from '@tiptap/extension-drag-handle-react'
import { useMemo } from 'react'
import { fromBlockJSON, toBlockJSON } from './mapping'
import { createEditorExtensions } from './schema'
import { EditorToolbar } from './toolbar'

/**
 * The block editor.
 *
 * It speaks the stored format, not ProseMirror's: `initialBlocks` and `onChange`
 * are Block JSON, and the two conversions happen here, inside the package. That
 * is deliberate. A caller holding ProseMirror JSON would have to import the
 * mapping layer to store anything, and in the admin that means the editor's
 * dependencies land in the first-screen bundle however carefully the component
 * itself is lazy-loaded.
 *
 * Producing HTML is `blockToHtml`'s job alone, so nothing here emits markup.
 *
 * Three ways to reach every block, in increasing order of how much a keyboard is
 * required: the toolbar, the `/` menu, and the shortcuts for moving a block.
 */

export interface BlockEditorProps {
  /** Stored Block JSON to open. */
  initialBlocks?: Block[]
  /** Called with stored Block JSON after every change. */
  onChange?: (blocks: Block[]) => void
  /** Set false to render a read-only preview. */
  editable?: boolean
  /** Accessible name for the editable region. */
  label?: string
}

const EMPTY_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export function BlockEditor({
  initialBlocks,
  onChange,
  editable = true,
  label = 'Content',
}: BlockEditorProps) {
  const extensions = useMemo(() => createEditorExtensions(), [])

  const editor = useEditor({
    extensions,
    content: initialBlocks === undefined ? EMPTY_DOCUMENT : fromBlockJSON(initialBlocks),
    editable,
    editorProps: {
      attributes: {
        // The editable region is a tab stop; without a name it is announced as
        // an unlabelled text area.
        'aria-label': label,
        class: 'min-h-40 px-3 py-2 focus:outline-none',
      },
    },
    onUpdate: ({ editor: current }) => onChange?.(toBlockJSON(current.getJSON())),
  })

  // `useEditor` returns null on the first render by design.
  if (editor === null) return null

  return (
    <div className="rounded-md border border-neutral-300 bg-white">
      {editable && <EditorToolbar editor={editor} />}

      <div className="relative">
        {editable && (
          // The handle is a pointer affordance; the keyboard equivalents are the
          // move buttons and Mod-Shift-Arrow, which is why it can be hidden from
          // assistive technology without taking the capability away.
          <DragHandle editor={editor} className="drag-handle">
            <span
              aria-hidden="true"
              title="Drag to move this block"
              className="flex h-6 w-5 cursor-grab items-center justify-center rounded text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
            >
              <svg viewBox="0 0 10 16" className="h-4 w-3 fill-current">
                <circle cx="2" cy="3" r="1.2" />
                <circle cx="8" cy="3" r="1.2" />
                <circle cx="2" cy="8" r="1.2" />
                <circle cx="8" cy="8" r="1.2" />
                <circle cx="2" cy="13" r="1.2" />
                <circle cx="8" cy="13" r="1.2" />
              </svg>
            </span>
          </DragHandle>
        )}

        <EditorContent editor={editor} />
      </div>
    </div>
  )
}
