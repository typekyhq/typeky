import { Extension } from '@tiptap/core'
import { ReactRenderer, type Editor } from '@tiptap/react'
import { Suggestion, type SuggestionKeyDownProps, type SuggestionProps } from '@tiptap/suggestion'
import { forwardRef, useEffect, useImperativeHandle, useState, type Ref } from 'react'
import { matchBlockActions, type BlockAction } from './block-actions'

/**
 * The slash menu: type `/`, pick a block.
 *
 * This is the keyboard path to everything the toolbar can do, which is what makes
 * "write a page without touching the mouse" possible. The editor keeps focus
 * throughout -- the menu is a popup that reads key events, not a form that steals
 * them -- so Up/Down/Enter are handled here and everything else falls through to
 * ProseMirror.
 */

interface SlashMenuListProps {
  items: BlockAction[]
  command: (item: BlockAction) => void
}

export interface SlashMenuHandle {
  onKeyDown: (props: SuggestionKeyDownProps) => boolean
}

const ITEM_CLASS =
  'cursor-pointer rounded px-2 py-1 text-sm aria-selected:bg-neutral-100 aria-selected:font-medium'

export const SlashMenuList = forwardRef<SlashMenuHandle, SlashMenuListProps>(
  function SlashMenuList({ items, command }, ref: Ref<SlashMenuHandle>) {
    const [selected, setSelected] = useState(0)

    // A new query means a new list; keeping the old index would select something
    // the author never looked at.
    useEffect(() => setSelected(0), [items])

    useImperativeHandle(
      ref,
      () => ({
        onKeyDown: ({ event }) => {
          if (items.length === 0) return false

          if (event.key === 'ArrowUp') {
            setSelected((index) => (index + items.length - 1) % items.length)
            return true
          }

          if (event.key === 'ArrowDown') {
            setSelected((index) => (index + 1) % items.length)
            return true
          }

          if (event.key === 'Enter') {
            const item = items[selected]
            if (item !== undefined) command(item)
            return true
          }

          return false
        },
      }),
      [items, command, selected],
    )

    if (items.length === 0) {
      return (
        <div className="rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-500 shadow-md">
          No block matches
        </div>
      )
    }

    return (
      <ul
        role="listbox"
        aria-label="Blocks"
        className="max-h-64 w-52 overflow-y-auto rounded-md border border-neutral-200 bg-white p-1 shadow-md"
      >
        {items.map((item, index) => (
          <li
            key={item.label}
            role="option"
            aria-selected={index === selected}
            className={ITEM_CLASS}
            onMouseEnter={() => setSelected(index)}
            // preventDefault so the editor does not lose focus before the
            // command runs; without it the click lands on a blurred editor.
            onMouseDown={(event) => {
              event.preventDefault()
              command(item)
            }}
          >
            {item.label}
          </li>
        ))}
      </ul>
    )
  },
)

type SuggestionMenuProps = SuggestionProps<BlockAction, BlockAction>

export const SlashMenu = Extension.create({
  name: 'slashMenu',

  addProseMirrorPlugins() {
    return [
      Suggestion<BlockAction, BlockAction>({
        editor: this.editor,
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }) => matchBlockActions(query),
        command: ({ editor, range, props }) => props.apply(editor, range),
        render: () => {
          let renderer: ReactRenderer<SlashMenuHandle, SlashMenuListProps> | null = null
          let container: HTMLDivElement | null = null

          // Fixed positioning, so the menu needs no positioning library: the
          // client rect is already in viewport coordinates.
          const place = (props: SuggestionMenuProps) => {
            const rect = props.clientRect?.()
            if (container === null || rect == null) return

            container.style.left = `${rect.left}px`
            container.style.top = `${rect.bottom + 4}px`
          }

          return {
            onStart: (props) => {
              renderer = new ReactRenderer<SlashMenuHandle, SlashMenuListProps>(SlashMenuList, {
                props,
                editor: props.editor as Editor,
              })

              container = document.createElement('div')
              container.className = 'fixed z-50'
              container.appendChild(renderer.element)
              document.body.appendChild(container)

              place(props)
            },

            onUpdate: (props) => {
              renderer?.updateProps(props)
              place(props)
            },

            onKeyDown: (props) => renderer?.ref?.onKeyDown(props) ?? false,

            onExit: () => {
              container?.remove()
              renderer?.destroy()
              container = null
              renderer = null
            },
          }
        },
      }),
    ]
  },
})
