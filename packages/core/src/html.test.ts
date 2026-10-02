import { describe, expect, it } from 'vitest'
import type { Block, ListItem } from './blocks'
import { blockToHtml, escapeHtml, safeUrl } from './html'

const paragraph = (...text: string[]): Block => ({
  type: 'paragraph',
  content: text.map((value) => ({ type: 'text', text: value })),
})

describe('escapeHtml', () => {
  it('escapes every character that can break out of text or an attribute', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })
})

describe('safeUrl', () => {
  it('accepts the schemes a link may use', () => {
    for (const url of ['https://example.com', 'http://example.com', 'mailto:a@b.c', 'tel:+123']) {
      expect(safeUrl(url), url).toBe(url)
    }
  })

  it('accepts URLs that are relative to the site', () => {
    for (const url of ['/about', '#section', '?page=2', '../up', 'posts/hello']) {
      expect(safeUrl(url), url).toBe(url)
    }
  })

  it('refuses schemes that execute', () => {
    for (const url of ['javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html;base64,x', 'vbscript:x']) {
      expect(safeUrl(url), url).toBeNull()
    }
  })

  it('allows a protocol-relative URL, which carries no scheme of its own', () => {
    expect(safeUrl('//cdn.example.com/x.js')).toBe('//cdn.example.com/x.js')
  })

  it('treats an empty value as nothing to link to', () => {
    expect(safeUrl('')).toBeNull()
    expect(safeUrl('   ')).toBeNull()
  })
})

describe('rendering each block type', () => {
  it('renders a paragraph', () => {
    expect(blockToHtml([paragraph('Hello')])).toBe('<p>Hello</p>')
  })

  it('renders a heading at its own level', () => {
    for (const level of [2, 3, 4] as const) {
      expect(blockToHtml([{ type: 'heading', level, content: [{ type: 'text', text: 'Title' }] }])).toBe(
        `<h${level}>Title</h${level}>`,
      )
    }
  })

  it('renders a bulleted and a numbered list', () => {
    const items: ListItem[] = [{ content: [{ type: 'text', text: 'One' }], children: [] }]

    expect(blockToHtml([{ type: 'list', ordered: false, items }])).toBe('<ul><li><p>One</p></li></ul>')
    expect(blockToHtml([{ type: 'list', ordered: true, items }])).toBe('<ol><li><p>One</p></li></ol>')
  })

  it('renders a nested list inside its item', () => {
    const html = blockToHtml([
      {
        type: 'list',
        ordered: false,
        items: [
          {
            content: [{ type: 'text', text: 'Outer' }],
            children: [
              {
                type: 'list',
                ordered: true,
                items: [{ content: [{ type: 'text', text: 'Inner' }], children: [] }],
              },
            ],
          },
        ],
      },
    ])

    expect(html).toBe('<ul><li><p>Outer</p><ol><li><p>Inner</p></li></ol></li></ul>')
  })

  it('renders a quotation with all of its paragraphs', () => {
    expect(
      blockToHtml([{ type: 'quote', content: [paragraph('First'), paragraph('Second')] }]),
    ).toBe('<blockquote><p>First</p><p>Second</p></blockquote>')
  })

  it('renders a code block, with its language when it has one', () => {
    expect(blockToHtml([{ type: 'code', language: null, code: 'const a = 1' }])).toBe(
      '<pre><code>const a = 1</code></pre>',
    )
    expect(blockToHtml([{ type: 'code', language: 'ts', code: 'let a' }])).toBe(
      '<pre><code class="language-ts">let a</code></pre>',
    )
  })

  it('renders a divider', () => {
    expect(blockToHtml([{ type: 'divider' }])).toBe('<hr>')
  })

  it('renders an image with its media id, and a URL only when one can be resolved', () => {
    const image: Block = { type: 'image', mediaId: 'media_1', alt: 'A desk' }

    expect(blockToHtml([image])).toBe('<figure data-media-id="media_1" data-alt="A desk"></figure>')
    expect(blockToHtml([image], { resolveMediaUrl: (id) => `/media/${id}` })).toBe(
      '<figure data-media-id="media_1" data-alt="A desk"><img src="/media/media_1" alt="A desk" loading="lazy"></figure>',
    )
  })

  it('renders a video the same way', () => {
    const video: Block = { type: 'video', mediaId: 'media_2', title: null }

    expect(blockToHtml([video])).toBe('<figure data-media-kind="video" data-media-id="media_2"></figure>')
    expect(blockToHtml([video], { resolveMediaUrl: (id) => `/media/${id}` })).toContain(
      '<video src="/media/media_2" controls preload="metadata" title="">',
    )
  })

  it('renders a call to action as both data and markup', () => {
    const html = blockToHtml([
      { type: 'cta', title: 'Ready?', body: 'Start today.', label: 'Get started', href: '/contact' },
    ])

    expect(html).toBe(
      '<aside data-cta="true" data-title="Ready?" data-body="Start today." data-label="Get started" data-href="/contact">' +
        '<h3>Ready?</h3><p>Start today.</p><a href="/contact" rel="noopener">Get started</a></aside>',
    )
  })
})

describe('inline formatting', () => {
  it('wraps marked text in the right element, whatever order the marks arrive in', () => {
    const bold = { type: 'bold' } as const
    const italic = { type: 'italic' } as const

    expect(blockToHtml([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [bold] }] }])).toBe(
      '<p><strong>x</strong></p>',
    )
    expect(
      blockToHtml([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [italic, bold] }] }]),
    ).toBe('<p><strong><em>x</em></strong></p>')
    expect(
      blockToHtml([{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [bold, italic] }] }]),
    ).toBe('<p><strong><em>x</em></strong></p>')
  })

  it('renders a hard break', () => {
    expect(blockToHtml([{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] }])).toBe(
      '<p>a<br>b</p>',
    )
  })

  it('marks a link as noopener', () => {
    expect(
      blockToHtml([
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Site', marks: [{ type: 'link', href: 'https://example.com' }] }],
        },
      ]),
    ).toBe('<p><a href="https://example.com" rel="noopener">Site</a></p>')
  })
})

describe('the escaping that keeps user content from becoming markup', () => {
  it('escapes text, so a script tag in a paragraph stays text', () => {
    const html = blockToHtml([paragraph('<script>alert(1)</script>')])

    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(html).not.toContain('<script>')
  })

  it('escapes an attribute, so a quote cannot end it early', () => {
    const html = blockToHtml([{ type: 'image', mediaId: '" onload="alert(1)', alt: null }])

    expect(html).not.toContain('onload="alert(1)"')
    expect(html).toContain('&quot;')
  })

  it('escapes code, which is the place raw output would be most tempting', () => {
    const html = blockToHtml([{ type: 'code', language: null, code: '<script>alert(1)</script>' }])

    expect(html).toBe('<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>')
  })

  it('drops a javascript: link but keeps the words', () => {
    const html = blockToHtml([
      {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Click', marks: [{ type: 'link', href: 'javascript:alert(1)' }] }],
      },
    ])

    expect(html).toBe('<p>Click</p>')
  })

  it('drops a javascript: call-to-action link but keeps the banner', () => {
    const html = blockToHtml([
      { type: 'cta', title: 'T', body: 'B', label: 'Go', href: 'javascript:alert(1)' },
    ])

    // No anchor is produced, so the scheme is never in an executable position.
    expect(html).not.toContain('<a ')
    // It stays in the data attribute on purpose: the editor reads the four
    // fields back from there, so a bad href is something the author can see and
    // fix rather than something that silently disappears on save.
    expect(html).toContain('data-href="javascript:alert(1)"')
    expect(html).toBe(
      '<aside data-cta="true" data-title="T" data-body="B" data-label="Go" data-href="javascript:alert(1)">' +
        '<h3>T</h3><p>B</p></aside>',
    )
  })

  it('escapes a media id that would otherwise break out of the attribute', () => {
    const html = blockToHtml([{ type: 'video', mediaId: '"><script>x</script>', title: null }])

    expect(html).not.toContain('<script>')
  })
})

describe('documents', () => {
  it('renders nothing for an empty body', () => {
    expect(blockToHtml([])).toBe('')
  })

  it('renders blocks in order, with no separator', () => {
    expect(blockToHtml([paragraph('a'), { type: 'divider' }, paragraph('b')])).toBe('<p>a</p><hr><p>b</p>')
  })

  it('leaves an empty paragraph out, so it does not become blank space', () => {
    expect(blockToHtml([paragraph(), paragraph('b')])).toBe('<p>b</p>')
  })
})
