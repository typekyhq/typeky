import type { JSONContent } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useMemo } from 'react'
import { createEditorExtensions } from './schema'
import { EditorToolbar } from './toolbar'

/**
 * The block editor.
 *
 * Its `onChange` hands back ProseMirror JSON. Turning that into the stored Block
 * JSON is the mapping layer's job (M3-S2) and producing HTML is `blockToHtml`'s
 * (M3-S3) -- this component never touches either, which is what keeps the
 * editor's internal document model from leaking into stored content or markup.
 */

export interface BlockEditorProps {
  /** ProseMirror JSON to start from. */
  initialContent?: JSONContent
  /** Called with ProseMirror JSON after every change. */
  onChange?: (document: JSONContent) => void
  /** Set false to render a read-only preview. */
  editable?: boolean
  /** Accessible name for the editable region. */
  label?: string
}

const EMPTY_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export function BlockEditor({
  initialContent = EMPTY_DOCUMENT,
  onChange,
  editable = true,
  label = 'Content',
}: BlockEditorProps) {
  const extensions = useMemo(() => createEditorExtensions(), [])

  const editor = useEditor({
    extensions,
    content: initialContent,
    editable,
    editorProps: {
      attributes: {
        // The editable region is a tab stop; without a name it is announced as
        // an unlabelled text area.
        'aria-label': label,
        class: 'min-h-40 px-3 py-2 focus:outline-none',
      },
    },
    onUpdate: ({ editor: current }) => onChange?.(current.getJSON()),
  })

  // `useEditor` returns null on the first render by design.
  if (editor === null) return null

  return (
    <div className="rounded-md border border-neutral-300 bg-white">
      {editable && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  )
}
