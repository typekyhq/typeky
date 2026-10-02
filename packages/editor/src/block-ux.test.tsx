// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BlockEditor } from './block-editor'
import { BLOCK_ACTIONS, matchBlockActions } from './block-actions'
import { toBlockJSON } from './mapping'
import { createEditorExtensions } from './schema'

const open: Editor[] = []

function editorWith(content: JSONContent): Editor {
  const editor = new Editor({ extensions: createEditorExtensions(), content })
  open.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy()
})

function paragraph(text: string): JSONContent {
  return { type: 'paragraph', content: text === '' ? [] : [{ type: 'text', text }] }
}

function document(...blocks: JSONContent[]): JSONContent {
  return { type: 'doc', content: blocks }
}

/** The visible text of each top-level block, in order. */
function texts(editor: Editor): string[] {
  return (
    toBlockJSON(editor.getJSON())
      .map((block) => {
        if ('content' in block && Array.isArray(block.content)) {
          return block.content
            .map((inline) => ('text' in inline ? inline.text : ''))
            .join('')
        }
        return block.type
      })
      .filter((value) => value !== '')
  )
}

describe('moving a block', () => {
  it('swaps a block with the one above it', () => {
    const editor = editorWith(document(paragraph('First'), paragraph('Second')))
    // Inside the second paragraph: "First" occupies 0-6, so its text starts at 7.
    editor.commands.setTextSelection(9)

    expect(editor.commands.moveBlockUp()).toBe(true)

    expect(texts(editor)).toEqual(['Second', 'First'])
  })

  it('swaps a block with the one below it', () => {
    const editor = editorWith(document(paragraph('First'), paragraph('Second')))
    editor.commands.setTextSelection(3)

    expect(editor.commands.moveBlockDown()).toBe(true)

    expect(texts(editor)).toEqual(['Second', 'First'])
  })

  it('keeps the cursor with the block that moved', () => {
    const editor = editorWith(document(paragraph('First'), paragraph('Second')))
    editor.commands.setTextSelection(9)

    editor.commands.moveBlockUp()

    // Still in "Second", which is now first; otherwise the next keystroke would
    // land in the wrong block and the shortcut would feel broken.
    expect(editor.state.selection.$from.parent.textContent).toBe('Second')
  })

  it('refuses to move the first block up or the last one down', () => {
    const editor = editorWith(document(paragraph('Only')))

    expect(editor.commands.moveBlockUp()).toBe(false)
    expect(editor.commands.moveBlockDown()).toBe(false)
  })

  it('moves an atom block, which has no text cursor of its own', () => {
    const editor = editorWith(document(paragraph('Text'), { type: 'horizontalRule' }))
    editor.commands.setTextSelection(2)

    expect(editor.commands.moveBlockDown()).toBe(true)

    // The divider started last; ProseMirror keeps a trailing paragraph so there
    // is somewhere to put the cursor, which is why this checks the first block
    // rather than the whole shape.
    expect(toBlockJSON(editor.getJSON())[0]?.type).toBe('divider')
  })

  it('answers the keyboard shortcut', () => {
    const editor = editorWith(document(paragraph('First'), paragraph('Second')))
    editor.commands.setTextSelection(9)

    // `Mod` maps to Command on macOS and Control elsewhere, and only one of them
    // matches a given event: setting both would produce a key name ProseMirror
    // has no binding for.
    const mac = /Mac|iP(hone|[oa]d)/.test(navigator.platform)

    editor.view.dom.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowUp',
        metaKey: mac,
        ctrlKey: !mac,
        shiftKey: true,
        bubbles: true,
      }),
    )

    expect(texts(editor)).toEqual(['Second', 'First'])
  })
})

describe('matching blocks for the slash menu', () => {
  it('offers every block for an empty query', () => {
    expect(matchBlockActions('').length).toBeGreaterThanOrEqual(9)
  })

  it('matches on the label', () => {
    expect(matchBlockActions('head').map((action) => action.label)).toEqual([
      'Heading 2',
      'Heading 3',
      'Heading 4',
    ])
  })

  it('matches on a keyword, because people type h2 or hr rather than the label', () => {
    expect(matchBlockActions('h3').map((action) => action.label)).toEqual(['Heading 3'])
    expect(matchBlockActions('hr').map((action) => action.label)).toEqual(['Divider'])
    expect(matchBlockActions('ul').map((action) => action.label)).toEqual(['Bulleted list'])
  })
  it('ignores case and surrounding spaces', () => {
    expect(matchBlockActions('  IMAGE ').map((action) => action.label)).toEqual(['Image'])
  })

  it('offers nothing for a query that matches nothing', () => {
    expect(matchBlockActions('zzzz')).toEqual([])
  })
})

describe('the slash menu', () => {
  it('opens when a slash is typed and offers the blocks', async () => {
    render(<BlockEditor />)
    const editor = screen.getByRole('textbox', { name: 'Content' })

    // Inserting through the command rather than by typing: jsdom does not
    // implement contenteditable input, so the plugin is driven the way any
    // other transaction would drive it.
    await drive(editor)

    const menu = await screen.findByRole('listbox', { name: 'Blocks' })
    expect(within(menu).getAllByRole('option').length).toBeGreaterThanOrEqual(9)
  })

  it('filters as the query grows', async () => {
    render(<BlockEditor />)
    const editor = screen.getByRole('textbox', { name: 'Content' })

    await drive(editor, '/quo')

    const menu = await screen.findByRole('listbox', { name: 'Blocks' })
    expect(within(menu).getAllByRole('option').map((option) => option.textContent)).toEqual(['Quote'])
  })

  it('closes and says so when nothing matches', async () => {
    render(<BlockEditor />)
    const editor = screen.getByRole('textbox', { name: 'Content' })

    await drive(editor, '/zzzz')

    expect(await screen.findByText('No block matches')).toBeTruthy()
    expect(screen.queryByRole('listbox')).toBeNull()
  })
})

/**
 * Puts text into the editor the way a transaction would.
 *
 * jsdom has no contenteditable implementation, so typing is not available here;
 * the suggestion plugin watches transactions, which is what this drives.
 */
async function drive(dom: HTMLElement, text = '/'): Promise<void> {
  const editor = (dom as HTMLElement & { editor?: Editor }).editor
  if (editor === undefined) throw new Error('the editor instance is not attached')

  editor.commands.focus('end')
  editor.commands.insertContent(text)
  await waitFor(() => undefined)
}

/** The node each action should leave behind, for the reachability sweep. */
const EXPECTED_NODE: Record<string, string> = {
  Paragraph: 'paragraph',
  'Heading 2': 'heading',
  'Heading 3': 'heading',
  'Heading 4': 'heading',
  'Bulleted list': 'bulletList',
  'Numbered list': 'orderedList',
  Quote: 'blockquote',
  Code: 'codeBlock',
  Divider: 'horizontalRule',
  Image: 'image',
  Video: 'video',
  'Call to action': 'cta',
}

function nodeTypes(editor: Editor): string[] {
  const found: string[] = []

  const walk = (node: JSONContent) => {
    if (typeof node.type === 'string') found.push(node.type)
    for (const child of node.content ?? []) walk(child)
  }

  walk(editor.getJSON())
  return found
}

function applyAction(editor: Editor, label: string): void {
  const action = BLOCK_ACTIONS.find((candidate) => candidate.label === label)
  if (action === undefined) throw new Error(`no action called ${label}`)

  action.apply(editor)
}

describe('the acceptance: a page without a pointer', () => {
  it('reaches every block type from the keyboard, one document at a time', () => {
    for (const action of BLOCK_ACTIONS) {
      const editor = editorWith(document(paragraph('')))
      editor.commands.focus('end')

      applyAction(editor, action.label)

      const expected = EXPECTED_NODE[action.label]
      expect(expected, `no expectation recorded for ${action.label}`).toBeDefined()
      expect(nodeTypes(editor), action.label).toContain(expected)
    }
  })

  it('lays out a heading, a list and an image in one document', () => {
    const editor = editorWith(document(paragraph('Title')))

    // 1. The title paragraph becomes a heading.
    applyAction(editor, 'Heading 2')

    // 2. A paragraph appended after it, then turned into a list. The cursor has
    //    to be inside that paragraph for the toggle to apply to it.
    const afterHeading = editor.state.doc.content.size
    editor.chain().insertContentAt(afterHeading, paragraph('Body')).run()
    editor.commands.setTextSelection(afterHeading + 3)
    applyAction(editor, 'Bulleted list')

    // 3. An image, appended.
    editor.chain().insertContentAt(editor.state.doc.content.size, { type: 'image' }).run()

    // Empty paragraphs are skipped: inserting a block leaves one behind so there
    // is somewhere to put the cursor, and `blockToHtml` renders nothing for them.
    const meaningful = toBlockJSON(editor.getJSON()).filter(
      (block) => !(block.type === 'paragraph' && block.content.length === 0),
    )

    expect(meaningful.map((block) => block.type)).toEqual(['heading', 'list', 'image'])
  })
})
