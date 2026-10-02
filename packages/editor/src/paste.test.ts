// @vitest-environment jsdom
import type { Block } from '@typeky/core'
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { htmlToBlocks } from './inbound'
import { cleanPastedHtml } from './paste'
import { createEditorExtensions } from './schema'

const open: Editor[] = []

function editorWith(content?: JSONContent): Editor {
  const editor = new Editor({
    extensions: createEditorExtensions(),
    content: content ?? { type: 'doc', content: [{ type: 'paragraph' }] },
  })
  open.push(editor)
  return editor
}

afterEach(() => {
  for (const editor of open.splice(0)) editor.destroy()
})

function parse(html: string): Block[] {
  return htmlToBlocks(html, editorWith().schema)
}

/** The plain text of every block, in order, for the cases where that is the point. */
function textOf(blocks: Block[]): string[] {
  return blocks.map((block) => {
    if (block.type === 'paragraph' || block.type === 'heading') {
      return block.content.map((node) => ('text' in node ? node.text : '')).join('')
    }
    return block.type
  })
}

describe('tables, which the block model cannot represent', () => {
  const TABLE =
    '<table><thead><tr><th>Plan</th><th>Price</th></tr></thead>' +
    '<tbody><tr><td>Basic</td><td>$10</td></tr><tr><td>Pro</td><td>$30</td></tr></tbody></table>'

  it('becomes one paragraph per row rather than a run of glued-together cells', () => {
    expect(textOf(parse(TABLE))).toEqual(['Plan | Price', 'Basic | $10', 'Pro | $30'])
  })

  it('is flattened the same way when it is actually pasted', () => {
    // The real path, not the helper: this is what the clipboard goes through,
    // including the `transformPastedHTML` hook. jsdom has no ClipboardEvent, so
    // the smallest thing ProseMirror needs is stood in for.
    const editor = editorWith()
    const event = Object.assign(new Event('paste'), {
      clipboardData: { getData: () => '', types: [] },
    }) as unknown as ClipboardEvent

    editor.view.pasteHTML(TABLE, event)

    expect(editor.view.dom.textContent).toContain('Plan | Price')
    expect(editor.view.dom.textContent).toContain('Basic | $10')
    expect(editor.view.dom.textContent).not.toContain('PlanPrice')
  })

  it('skips an empty cell rather than emitting a blank line', () => {
    expect(textOf(parse('<table><tr><td></td><td>Only</td></tr></table>'))).toEqual(['Only'])
  })
})

describe('invisible characters', () => {
  it('strips the zero-width spaces Word leaves behind', () => {
    // Inside a word, which survives parsing and then defeats search.
    expect(textOf(parse('<p>wo&#8203;rd</p>'))).toEqual(['word'])
  })

  it('keeps a non-breaking space, which is a space a reader can see', () => {
    // Preserved as U+00A0 rather than normalised: it is a deliberate space, not
    // an invisible character.
    expect(textOf(parse('<p>a&nbsp;b</p>'))).toEqual(['a\u00a0b'])
  })
})

describe('a page pasted from the web', () => {
  const PAGE = `
    <div class="wrapper">
      <h1>Big title</h1>
      <p>Normal <span style="color:#c00;font-weight:700">red bold</span> text</p>
      <img src="https://example.com/photo.jpg" alt="A photo" onerror="alert(1)">
      <ul><li>One<ul><li>Nested</li></ul></li></ul>
      <div class="highlight"><pre><code class="language-js">const a = 1</code></pre></div>
    </div>`

  it('keeps the text and the structure, and nothing else', () => {
    expect(parse(PAGE)).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Big title' }] },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Normal ' },
          { type: 'text', text: 'red bold', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' text' },
        ],
      },
      {
        type: 'list',
        ordered: false,
        items: [
          {
            content: [{ type: 'text', text: 'One' }],
            children: [
              {
                type: 'list',
                ordered: false,
                items: [{ content: [{ type: 'text', text: 'Nested' }], children: [] }],
              },
            ],
          },
        ],
      },
      { type: 'code', language: 'js', code: 'const a = 1' },
    ])
  })

  it('does not keep the heading level, because a body has no h1', () => {
    expect(parse('<h1>Title</h1>')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Title' }] },
    ])
  })

  it('drops an image rather than hotlinking it', () => {
    // Known limitation: a block stores a media id, and a pasted remote image has
    // none. It disappears until the media library can accept an upload.
    expect(parse('<p>Before</p><img src="https://example.com/x.jpg"><p>After</p>')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Before' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'After' }] },
    ])
  })

  it('drops an embed and keeps the text around it', () => {
    expect(textOf(parse('<p>Before</p><iframe src="https://evil.test"></iframe><p>After</p>'))).toEqual([
      'Before',
      'After',
    ])
  })
})

describe('a paste from Word', () => {
  const WORD = `
    <style><!-- p.MsoNormal {mso-style-parent:"";} --></style>
    <p class=MsoNormal>Word text<span style='mso-spacerun:yes'> </span>here<o:p></o:p></p>
    <table><tr><td>Rate</td><td>1%</td></tr></table>`

  it('keeps the words and drops the machinery', () => {
    expect(textOf(parse(WORD))).toEqual(['Word text here', 'Rate | 1%'])
  })
})

describe('html that would be dangerous anywhere else', () => {
  it('drops scripts and styles entirely, including their text', () => {
    expect(parse('<p>Safe</p><script>alert(1)</script><style>body{}</style>')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Safe' }] },
    ])
  })

  it('refuses a javascript: href, which the link extension rejects on the way in', () => {
    expect(parse('<p><a href="javascript:alert(1)">Click</a></p>')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Click' }] },
    ])
  })

  it('refuses a data: href too', () => {
    expect(parse('<p><a href="data:text/html,<script>x</script>">Click</a></p>')).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Click' }] },
    ])
  })

  it('keeps an ordinary link and a site-relative one', () => {
    expect(parse('<p><a href="https://example.com">Ext</a> <a href="/about">Rel</a></p>')).toEqual([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Ext', marks: [{ type: 'link', href: 'https://example.com' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'Rel', marks: [{ type: 'link', href: '/about' }] },
        ],
      },
    ])
  })

  it('never lets a tag become markup in the stored content', () => {
    const blocks = parse('<p>Text</p><marquee onstart="alert(1)">Sneaky</marquee>')

    expect(JSON.stringify(blocks)).not.toContain('<')
    expect(textOf(blocks)).toEqual(['Text', 'Sneaky'])
  })
})

describe('cleanPastedHtml', () => {
  it('leaves html that needs nothing alone', () => {
    const html = '<p>Plain <strong>bold</strong></p>'

    expect(cleanPastedHtml(html)).toBe(html)
  })

  it('is safe to run on an empty string', () => {
    expect(cleanPastedHtml('')).toBe('')
  })
})
