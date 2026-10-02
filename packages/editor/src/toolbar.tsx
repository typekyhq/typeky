import { type Editor, useEditorState } from '@tiptap/react'
import { BLOCK_ACTIONS } from './block-actions'

/**
 * The toolbar.
 *
 * Deliberately plain and complete: one button per block type plus the two move
 * buttons, which together are what makes every block reachable without the
 * keyboard shortcuts and the slash menu. Everything here is a real button with a
 * name, so it is reachable by Tab and Enter like anything else on the page.
 */

const BUTTON =
  'rounded border px-2 py-1 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:outline-none'
const INACTIVE = 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-100'
const ACTIVE = 'border-neutral-400 bg-neutral-200 font-medium text-neutral-900'

export function EditorToolbar({ editor }: { editor: Editor }) {
  // Only the toolbar re-renders when the selection moves. Re-rendering the whole
  // editor on every transaction is the old behaviour and is off by default.
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      active: BLOCK_ACTIONS.map((action) => action.isActive(current)),
      canMoveUp: current.can().moveBlockUp(),
      canMoveDown: current.can().moveBlockDown(),
    }),
  })

  return (
    <div role="toolbar" aria-label="Blocks" className="flex flex-wrap gap-1 border-b border-neutral-200 p-2">
      <button
        type="button"
        className={`${BUTTON} ${INACTIVE} disabled:opacity-40`}
        aria-label="Move block up"
        disabled={!state.canMoveUp}
        onClick={() => editor.chain().focus().moveBlockUp().run()}
      >
        ↑
      </button>
      <button
        type="button"
        className={`${BUTTON} ${INACTIVE} disabled:opacity-40`}
        aria-label="Move block down"
        disabled={!state.canMoveDown}
        onClick={() => editor.chain().focus().moveBlockDown().run()}
      >
        ↓
      </button>

      <span className="mx-1 w-px self-stretch bg-neutral-200" aria-hidden="true" />

      {BLOCK_ACTIONS.map((action, index) => (
        <button
          key={action.label}
          type="button"
          // aria-pressed rather than a class, so the state is available to
          // assistive technology and to tests.
          aria-pressed={state.active[index] ?? false}
          className={`${BUTTON} ${state.active[index] === true ? ACTIVE : INACTIVE}`}
          onClick={() => action.apply(editor)}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
