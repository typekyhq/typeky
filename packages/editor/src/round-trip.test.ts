// @vitest-environment jsdom
import { blockToHtml } from '@typeky/core'
import type { Block } from '@typeky/core'
import { Editor } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { htmlToBlocks } from './inbound'
import { createEditorExtensions } from './schema'

/**
 * The consistency guarantee from architecture section 3.11: HTML produced by
 * `blockToHtml` parses back into exactly the blocks it came from.
 *
 * This is what makes "one HTML producer" safe to rely on. If the renderer and
 * the parser disagree about anything -- an attribute name, whether a list item
 * carries a paragraph -- this is where it shows.
 */

const DOCUMENT: Block[] = [
  { type: 'heading', level: 3, content: [{ type: 'text', text: 'A heading' }] },
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Plain, ' },
      { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
      { type: 'text', text: ', ' },
      { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
      { type: 'text', text: ', ' },
      { type: 'text', text: 'code', marks: [{ type: 'code' }] },
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
      { type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'And again' }] },
    ],
  },
  { type: 'code', language: 'ts', code: 'const a = 1\nconst b = 2' },
  { type: 'image', mediaId: 'media_logo', alt: 'A desk' },
  { type: 'video', mediaId: 'media_clip', title: 'A clip' },
  { type: 'divider' },
  { type: 'cta', title: 'Ready?', body: 'Start today.', label: 'Get started', href: '/contact' },
]

const RESOLVE = (mediaId: string) => `/media/${mediaId}`

const open: Editor[] = []

function schema() {
  const editor = new Editor({ extensions: createEditorExtensions() })
  open.push(editor)
  return editor.schema
}

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy()
})

describe('html round trip', () => {
  it('gets back exactly the blocks the html was rendered from', () => {
    const html = blockToHtml(DOCUMENT, { resolveMediaUrl: RESOLVE })

    expect(htmlToBlocks(html, schema())).toEqual(DOCUMENT)
  })

  it('does not need a media resolver to keep the media ids', () => {
    // Without a resolver the markup has no `src`, and the round trip still has
    // to work: the id is what is stored, the URL is what is rendered.
    const html = blockToHtml(DOCUMENT)

    expect(htmlToBlocks(html, schema())).toEqual(DOCUMENT)
  })

  it('survives a second pass', () => {
    const first = htmlToBlocks(blockToHtml(DOCUMENT, { resolveMediaUrl: RESOLVE }), schema())
    const second = htmlToBlocks(blockToHtml(first, { resolveMediaUrl: RESOLVE }), schema())

    expect(second).toEqual(first)
  })

  it('renders nothing for an empty body and parses nothing back', () => {
    expect(htmlToBlocks('', schema())).toEqual([])
  })
})

describe('each block type on its own', () => {
  for (const block of DOCUMENT) {
    it(`keeps a ${block.type} through html`, () => {
      const html = blockToHtml([block], { resolveMediaUrl: RESOLVE })

      expect(htmlToBlocks(html, schema())).toEqual([block])
    })
  }
})

describe('html the renderer did not produce', () => {
  it('does not invent a node for a tag the schema does not know', () => {
    // The point is that `<marquee>` becomes an ordinary paragraph rather than
    // some node of its own; the words are kept rather than dropped.
    expect(htmlToBlocks('<p>Kept</p><marquee>Dropped</marquee>', schema())).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Kept' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Dropped' }] },
    ])
  })

  it('drops a script tag rather than turning it into a block', () => {
    const blocks = htmlToBlocks('<p>Safe</p><script>alert(1)</script>', schema())

    expect(blocks).toEqual([{ type: 'paragraph', content: [{ type: 'text', text: 'Safe' }] }])
  })

  it('turns an h1 into a paragraph, because a body has no h1', () => {
    // The page title is the entry's, not the body's (section 3.8). Keeping the
    // words as a paragraph is better than dropping them.
    expect(htmlToBlocks('<h1>Not a body heading</h1>', schema())).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Not a body heading' }] },
    ])
  })

  it('keeps bold text that arrives as a <b> or a <strong>', () => {
    expect(htmlToBlocks('<p><b>bold</b> and <strong>also bold</strong></p>', schema())).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' and ' },
          { type: 'text', text: 'also bold', marks: [{ type: 'bold' }] },
        ],
      },
    ])
  })
})
