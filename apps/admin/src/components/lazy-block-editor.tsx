import type { BlockEditorProps } from '@typeky/editor'
import { Suspense, lazy } from 'react'
import { LoadingState } from './states'

/**
 * The block editor, loaded only when a screen renders it.
 *
 * Tiptap is the largest thing in the admin, and only one screen needs it. A
 * static import would put it in the first screen of every screen; this keeps it
 * in its own chunk, which is the arrangement architecture section 3.3 asks for
 * and the one the size budget in section 3.11 is measured against.
 *
 * The type import above is erased at build time, so it does not defeat that.
 */
const BlockEditor = lazy(async () => {
  const editor = await import('@typeky/editor')
  return { default: editor.BlockEditor }
})

export function LazyBlockEditor(props: BlockEditorProps) {
  return (
    <Suspense fallback={<LoadingState label="Loading the editor" className="p-4" />}>
      <BlockEditor {...props} />
    </Suspense>
  )
}
