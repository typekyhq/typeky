import { Extension } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Fragment } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'

/**
 * Moving a block.
 *
 * ProseMirror already splits on Enter and merges on Backspace, so "block editing"
 * only needs the operation it has no opinion about: swapping a block with its
 * neighbour.
 *
 * This works on the top-level document rather than on the selection, so the same
 * command serves the keyboard shortcut, the toolbar button and the drag handle --
 * "up" means the block before this one, whatever kind of block it is.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockMovement: {
      moveBlockUp: () => ReturnType
      moveBlockDown: () => ReturnType
    }
  }
}

export const BlockMovement = Extension.create({
  name: 'blockMovement',

  addCommands() {
    return {
      moveBlockUp: () => moveBlock(-1),
      moveBlockDown: () => moveBlock(1),
    }
  },

  addKeyboardShortcuts() {
    return {
      // Notion's shortcut, and the one people reach for.
      'Mod-Shift-ArrowUp': () => this.editor.commands.moveBlockUp(),
      'Mod-Shift-ArrowDown': () => this.editor.commands.moveBlockDown(),
    }
  },
})

interface CommandProps {
  state: EditorState
  dispatch?: (transaction: Transaction) => void
}

function moveBlock(direction: -1 | 1) {
  return ({ state, dispatch }: CommandProps): boolean => {
    const index = state.selection.$from.index(0)
    const target = index + direction

    // Already first or last: say so rather than doing nothing quietly.
    if (index < 0 || target < 0 || target >= state.doc.childCount) return false

    const children: ProseMirrorNode[] = []
    state.doc.forEach((child) => children.push(child))

    const moved = children[index]
    children.splice(index, 1)
    children.splice(target, 0, moved)

    // `can()` mode: report that the move is possible without applying it.
    if (dispatch === undefined) return true

    const transaction = state.tr.replaceWith(0, state.doc.content.size, Fragment.fromArray(children))

    // Keep the cursor with the block that moved, or the author loses their place
    // and the shortcut feels broken.
    let position = 0
    for (let step = 0; step < target; step += 1) position += children[step].nodeSize

    transaction.setSelection(
      moved.isAtom || moved.isLeaf
        ? NodeSelection.create(transaction.doc, position)
        : TextSelection.near(transaction.doc.resolve(position + 1)),
    )

    dispatch(transaction.scrollIntoView())
    return true
  }
}
