// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BlockEditor } from './block-editor'
import { createEditorExtensions, HEADING_LEVELS } from './schema'
import { BLOCK_ACTIONS } from './toolbar'

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

/** Every node type in the document, flattened. */
function nodeTypes(document: JSONContent): string[] {
  const found: string[] = []

  const walk = (node: JSONContent) => {
    if (typeof node.type === 'string') found.push(node.type)
    for (const child of node.content ?? []) walk(child)
  }

  walk(document)
  return found
}

function findNode(document: JSONContent, type: string): JSONContent | undefined {
  if (document.type === type) return document
  for (const child of document.content ?? []) {
    const found = findNode(child, type)
    if (found !== undefined) return found
  }
  return undefined
}

describe('the schema', () => {
  it('has the nine block types', () => {
    const editor = editorWith()
    const names = Object.keys(editor.schema.nodes)

    for (const expected of [
      'paragraph',
      'heading',
      'bulletList',
      'orderedList',
      'blockquote',
      'codeBlock',
      'horizontalRule',
      'image',
      'video',
      'cta',
    ]) {
      expect(names, expected).toContain(expected)
    }
  })

  it('leaves out the blocks that are deliberately not in this round', () => {
    const names = Object.keys(editorWith().schema.nodes)

    for (const deferred of ['table', 'embed', 'productCard']) {
      expect(names, deferred).not.toContain(deferred)
    }
  })

  it('offers bold, italic, code and link, and nothing else', () => {
    const marks = Object.keys(editorWith().schema.marks).sort()

    for (const expected of ['bold', 'code', 'italic', 'link']) expect(marks).toContain(expected)
    // Strike and underline would survive in the document and then render as
    // nothing, which is worse than not offering them at all.
    expect(marks).not.toContain('strike')
    expect(marks).not.toContain('underline')
  })

  it('refuses a heading level outside h2 to h4', () => {
    const editor = editorWith()

    expect(HEADING_LEVELS).toEqual([2, 3, 4])
    expect(editor.commands.setHeading({ level: 1 })).toBe(false)
    expect(editor.commands.setHeading({ level: 5 })).toBe(false)
    expect(editor.commands.setHeading({ level: 3 })).toBe(true)
  })

  it('does not turn pasted h1 markup into an h1', () => {
    const editor = editorWith()

    editor.commands.setContent('<h1>Page title</h1><p>Body</p>')

    const headings = nodeTypes(editor.getJSON()).filter((type) => type === 'heading')
    expect(headings).toHaveLength(0)
  })
})

describe('inserting every block type', () => {
  const cases: Array<[string, (editor: Editor) => unknown, string]> = [
    ['paragraph', (editor) => editor.chain().setParagraph().run(), 'paragraph'],
    ['heading', (editor) => editor.chain().setHeading({ level: 2 }).run(), 'heading'],
    ['bulleted list', (editor) => editor.chain().toggleBulletList().run(), 'bulletList'],
    ['numbered list', (editor) => editor.chain().toggleOrderedList().run(), 'orderedList'],
    ['quote', (editor) => editor.chain().toggleBlockquote().run(), 'blockquote'],
    ['code', (editor) => editor.chain().toggleCodeBlock().run(), 'codeBlock'],
    ['divider', (editor) => editor.chain().setHorizontalRule().run(), 'horizontalRule'],
    ['image', (editor) => editor.chain().setImage().run(), 'image'],
    ['video', (editor) => editor.chain().setVideo().run(), 'video'],
    ['call to action', (editor) => editor.chain().setCta().run(), 'cta'],
  ]

  for (const [name, run, expected] of cases) {
    it(`can insert a ${name}`, () => {
      const editor = editorWith()

      run(editor)

      expect(nodeTypes(editor.getJSON())).toContain(expected)
    })
  }

  it('keeps a media id on an image and never a URL', () => {
    const editor = editorWith()

    editor.commands.setImage({ mediaId: 'media_123', alt: 'A desk' })

    const image = findNode(editor.getJSON(), 'image')
    expect(image?.attrs).toEqual({ mediaId: 'media_123', alt: 'A desk' })
    expect(JSON.stringify(image)).not.toContain('http')
  })

  it('carries the four call-to-action fields', () => {
    const editor = editorWith()

    editor.commands.setCta({ title: 'Ready?', body: 'Start today.', label: 'Get started', href: '/contact' })

    expect(findNode(editor.getJSON(), 'cta')?.attrs).toEqual({
      title: 'Ready?',
      body: 'Start today.',
      label: 'Get started',
      href: '/contact',
    })
  })
})

describe('the editor component', () => {
  it('names the editable region, so it is not an unlabelled text box', () => {
    render(<BlockEditor />)

    expect(screen.getByRole('textbox', { name: 'Content' })).toBeTruthy()
  })

  it('offers a button for every block type in the toolbar', () => {
    render(<BlockEditor />)

    const toolbar = screen.getByRole('toolbar', { name: 'Blocks' })
    for (const action of BLOCK_ACTIONS) {
      expect(toolbar.textContent, action.label).toContain(action.label)
    }
  })

  it('marks the active block with aria-pressed rather than a class alone', async () => {
    render(<BlockEditor />)

    const heading = screen.getByRole('button', { name: 'Heading 2' })
    expect(heading.getAttribute('aria-pressed')).toBe('false')

    await userEvent.click(heading)

    expect(screen.getByRole('button', { name: 'Heading 2' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('reports ProseMirror JSON after a change', async () => {
    const onChange = vi.fn()
    render(<BlockEditor onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Divider' }))

    expect(onChange).toHaveBeenCalled()
    const document = onChange.mock.calls.at(-1)?.[0] as JSONContent
    expect(nodeTypes(document)).toContain('horizontalRule')
  })

  it('hides the toolbar when it is read-only', () => {
    render(<BlockEditor editable={false} />)

    expect(screen.queryByRole('toolbar')).toBeNull()
    expect(screen.getByRole('textbox', { name: 'Content' })).toBeTruthy()
  })
})

describe('block node views', () => {
  it('shows an empty state for an image and offers alt text', () => {
    render(
      <BlockEditor initialContent={{ type: 'doc', content: [{ type: 'image', attrs: { mediaId: '', alt: null } }] }} />,
    )

    expect(screen.getByText('No image chosen yet.')).toBeTruthy()
    expect(screen.getByLabelText('Alt text')).toHaveProperty('value', '')
  })

  it('labels every call-to-action control', () => {
    render(<BlockEditor initialContent={{ type: 'doc', content: [{ type: 'cta' }] }} />)

    for (const label of ['Call to action title', 'Call to action body', 'Button label', 'Button link']) {
      expect(screen.getByLabelText(label), label).toBeTruthy()
    }
  })

  it('writes an edited attribute back to the document', async () => {
    const onChange = vi.fn()
    render(<BlockEditor initialContent={{ type: 'doc', content: [{ type: 'cta' }] }} onChange={onChange} />)

    await userEvent.type(screen.getByLabelText('Call to action title'), 'Hello')

    const document = onChange.mock.calls.at(-1)?.[0] as JSONContent
    expect(findNode(document, 'cta')?.attrs?.title).toBe('Hello')
  })
})
