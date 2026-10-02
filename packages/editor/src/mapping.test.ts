import { safeParseBlocks } from '@typeky/api'
import type { Block } from '@typeky/core'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { fromBlockJSON, toBlockJSON } from './mapping'
import { createEditorExtensions } from './schema'

/**
 * One document using every block type, including both nesting cases: a list
 * inside a list item, and a quotation with more than one paragraph.
 */
const DOCUMENT: Block[] = [
  { type: 'heading', level: 2, content: [{ type: 'text', text: 'Heading' }] },
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Plain, ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ', ' },
      { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'a link', marks: [{ type: 'link', href: 'https://example.com' }] },
      { type: 'hardBreak' },
      { type: 'text', text: 'after a break' },
    ],
  },
  {
    type: 'list',
    ordered: false,
    items: [
      { content: [{ type: 'text', text: 'First' }], children: [] },
      {
        content: [{ type: 'text', text: 'Second' }],
        children: [
          {
            type: 'list',
            ordered: true,
            items: [{ content: [{ type: 'text', text: 'Nested' }], children: [] }],
          },
        ],
      },
    ],
  },
  {
    type: 'quote',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First quoted line' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second quoted line' }] },
    ],
  },
  { type: 'code', language: null, code: 'const a = 1\nconst b = 2' },
  { type: 'image', mediaId: 'media_logo', alt: 'A desk' },
  { type: 'video', mediaId: 'media_clip', title: null },
  { type: 'divider' },
  { type: 'cta', title: 'Ready?', body: 'Start today.', label: 'Get started', href: '/contact' },
]

const open: Editor[] = []

function editorWith(blocks: Block[]): Editor {
  const editor = new Editor({ extensions: createEditorExtensions(), content: fromBlockJSON(blocks) })
  open.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy()
})

describe('block json round trip', () => {
  it('gives back exactly what it was given', () => {
    expect(toBlockJSON(fromBlockJSON(DOCUMENT))).toEqual(DOCUMENT)
  })

  it('does not drift on a second pass', () => {
    const once = toBlockJSON(fromBlockJSON(DOCUMENT))

    expect(toBlockJSON(fromBlockJSON(once))).toEqual(once)
  })

  it('survives a real editor in the middle', () => {
    // The strongest form: stored -> editor -> stored. If ProseMirror normalises
    // something the mapping cannot express, this is where it shows up.
    const editor = editorWith(DOCUMENT)

    expect(toBlockJSON(editor.getJSON())).toEqual(DOCUMENT)
  })

  it('produces blocks the stored contract accepts', () => {
    // Ties the mapping to the schema the API validates with: one is what the
    // editor writes, the other is what the server will accept.
    expect(safeParseBlocks(DOCUMENT)).toEqual(DOCUMENT)
  })
})

describe('handling of each block type', () => {
  for (const block of DOCUMENT) {
    it(`keeps a ${block.type} intact`, () => {
      expect(toBlockJSON(fromBlockJSON([block]))).toEqual([block])
    })
  }
})

describe('edges', () => {
  it('maps an empty body to an empty document and back', () => {
    expect(fromBlockJSON([])).toEqual({ type: 'doc', content: [] })
    expect(toBlockJSON({ type: 'doc', content: [] })).toEqual([])
  })

  it('gives an empty code block no content node, because a text node cannot be empty', () => {
    const empty: Block = { type: 'code', language: 'ts', code: '' }

    const document = fromBlockJSON([empty])

    expect(document.content?.[0]?.content).toEqual([])
    expect(toBlockJSON(document)).toEqual([empty])
  })

  it('keeps a list item whose text is empty', () => {
    const list: Block = { type: 'list', ordered: true, items: [{ content: [], children: [] }] }

    expect(toBlockJSON(fromBlockJSON([list]))).toEqual([list])
  })

  it('drops a node the mapping does not know, rather than guessing', () => {
    const document = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] },
        { type: 'somethingNew', attrs: {} },
      ],
    }

    expect(toBlockJSON(document)).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] }])
  })

  it('drops a mark the block model does not carry', () => {
    const document = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Struck', marks: [{ type: 'strike' }] }],
        },
      ],
    }

    expect(toBlockJSON(document)).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Struck' }] },
    ])
  })

  it('narrows an out-of-range heading level rather than emitting it', () => {
    const document = { type: 'doc', content: [{ type: 'heading', attrs: { level: 1 } }] }

    expect(toBlockJSON(document)).toEqual([{ type: 'heading', level: 2, content: [] }])
  })
})
