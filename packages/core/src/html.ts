import type { Block, InlineContent, InlineMark, ListBlock, ParagraphBlock } from './blocks'

/**
 * The only thing in the codebase that turns content into HTML.
 *
 * Two consequences follow from "only", and both matter:
 *
 *   - the admin's preview and the site's rendering cannot disagree, because
 *     there is nothing for them to disagree about;
 *   - because it is the only producer, it is also the only place that has to get
 *     escaping right. Every attribute and every run of text goes through
 *     `escapeHtml`, and every URL goes through `safeUrl` first.
 *
 * It takes and returns plain strings, so it runs in a Worker, in a Node script
 * and in a browser without a DOM (architecture section 3.11).
 */

export interface BlockToHtmlOptions {
  /**
   * Turns a media id into something an `<img>` or `<video>` can use.
   *
   * The id is written into the markup either way, so a missing resolver costs a
   * broken image rather than a broken round trip. Without one, media renders as
   * an empty placeholder rather than pointing at a URL that does not exist.
   */
  resolveMediaUrl?: (mediaId: string) => string | null
}

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character])
}

/** Schemes a link may use. Anything else is dropped. */
const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * `URL` exists in Workers, Node and browsers alike, and is declared here for the
 * same reason as `crypto` in `id.ts`: no single lib target this package compiles
 * against provides it, and depending on one would force every consumer to.
 */
declare const URL: { new (input: string): { readonly protocol: string } }

/**
 * Returns a URL safe to put in an attribute, or null.
 *
 * The threat is `javascript:` and its relatives: an author-controlled href is a
 * script execution point unless something rejects it. Relative URLs are allowed
 * because a site is full of them.
 */
export function safeUrl(value: string): string | null {
  const url = value.trim()
  if (url === '') return null

  // No scheme at all: `/about`, `#section`, `../x`, `?page=2`.
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return url
  // `//host/path` is protocol-relative and carries no scheme of its own.
  if (url.startsWith('//')) return url

  try {
    const parsed = new URL(url)
    return ALLOWED_SCHEMES.has(parsed.protocol) ? url : null
  } catch {
    return null
  }
}

export function blockToHtml(blocks: Block[], options: BlockToHtmlOptions = {}): string {
  return renderBlocks(blocks, options)
}

function renderBlocks(blocks: Block[], options: BlockToHtmlOptions): string {
  return blocks.map((block) => renderBlock(block, options)).join('')
}

function renderBlock(block: Block, options: BlockToHtmlOptions): string {
  switch (block.type) {
    case 'paragraph':
      return renderParagraph(block)

    case 'heading':
      // Levels are 2-4 by the type, so no clamping is needed here.
      return `<h${block.level}>${renderInline(block.content)}</h${block.level}>`

    case 'list':
      return renderList(block, options)

    case 'quote':
      return `<blockquote>${renderBlocks(block.content, options)}</blockquote>`

    case 'code':
      return renderCode(block)

    case 'image':
      return renderImage(block, options)

    case 'video':
      return renderVideo(block, options)

    case 'divider':
      return '<hr>'

    case 'cta':
      return renderCta(block)
  }
}

function renderParagraph(block: ParagraphBlock): string {
  const content = renderInline(block.content)
  return content === '' ? '' : `<p>${content}</p>`
}

function renderInline(content: InlineContent): string {
  return content
    .map((node) => {
      if (node.type === 'hardBreak') return '<br>'
      return applyMarks(escapeHtml(node.text), node.marks)
    })
    .join('')
}

function applyMarks(text: string, marks: InlineMark[] | undefined): string {
  let rendered = text

  // Wrapping in a fixed order keeps the output stable regardless of the order
  // the marks happen to arrive in.
  if (marks?.some((mark) => mark.type === 'code')) rendered = `<code>${rendered}</code>`
  if (marks?.some((mark) => mark.type === 'italic')) rendered = `<em>${rendered}</em>`
  if (marks?.some((mark) => mark.type === 'bold')) rendered = `<strong>${rendered}</strong>`

  const link = marks?.find((mark) => mark.type === 'link')
  if (link !== undefined) {
    const href = link.href === undefined ? null : safeUrl(link.href)
    if (href !== null) {
      rendered = `<a href="${escapeHtml(href)}" rel="noopener">${rendered}</a>`
    }
  }

  return rendered
}

function renderList(block: ListBlock, options: BlockToHtmlOptions): string {
  const tag = block.ordered ? 'ol' : 'ul'

  const items = block.items
    .map((item) => {
      const own = renderInline(item.content)
      // The paragraph is explicit rather than left implicit: ProseMirror wraps
      // it on the way back in either way, and being explicit keeps the round
      // trip from depending on that.
      const body = own === '' ? '' : `<p>${own}</p>`
      return `<li>${body}${renderBlocks(item.children, options)}</li>`
    })
    .join('')

  return `<${tag}>${items}</${tag}>`
}

function renderCode(block: Extract<Block, { type: 'code' }>): string {
  const language =
    block.language === null || block.language === ''
      ? ''
      : ` class="language-${escapeHtml(block.language)}"`

  // The code text is escaped like any other text. A code block is the one place
  // where an author might expect raw output, and it is exactly where raw output
  // would let a `<script>` through.
  return `<pre><code${language}>${escapeHtml(block.code)}</code></pre>`
}

function renderImage(block: Extract<Block, { type: 'image' }>, options: BlockToHtmlOptions): string {
  const attributes = [`data-media-id="${escapeHtml(block.mediaId)}"`]
  const src = block.mediaId === '' ? null : (options.resolveMediaUrl?.(block.mediaId) ?? null)

  if (block.alt !== null && block.alt !== '') {
    attributes.push(`data-alt="${escapeHtml(block.alt)}"`)
  }

  const alt = escapeHtml(block.alt ?? '')
  const image = src === null ? '' : `<img src="${escapeHtml(src)}" alt="${alt}" loading="lazy">`

  return `<figure ${attributes.join(' ')}>${image}</figure>`
}

function renderVideo(block: Extract<Block, { type: 'video' }>, options: BlockToHtmlOptions): string {
  const attributes = ['data-media-kind="video"', `data-media-id="${escapeHtml(block.mediaId)}"`]
  const src = block.mediaId === '' ? null : (options.resolveMediaUrl?.(block.mediaId) ?? null)

  if (block.title !== null && block.title !== '') {
    attributes.push(`data-title="${escapeHtml(block.title)}"`)
  }

  if (src === null) return `<figure ${attributes.join(' ')}></figure>`

  const title = escapeHtml(block.title ?? '')
  return `<figure ${attributes.join(' ')}><video src="${escapeHtml(src)}" controls preload="metadata" title="${title}"></video></figure>`
}

function renderCta(block: Extract<Block, { type: 'cta' }>): string {
  const href = safeUrl(block.href)

  // The four fields appear twice on purpose: as data attributes, which is what
  // the editor reads back, and as markup, which is what a visitor sees.
  const attributes = [
    'data-cta="true"',
    `data-title="${escapeHtml(block.title)}"`,
    `data-body="${escapeHtml(block.body)}"`,
    `data-label="${escapeHtml(block.label)}"`,
    `data-href="${escapeHtml(block.href)}"`,
  ]

  const heading = block.title === '' ? '' : `<h3>${escapeHtml(block.title)}</h3>`
  const body = block.body === '' ? '' : `<p>${escapeHtml(block.body)}</p>`
  const action =
    href === null || block.label === ''
      ? ''
      : `<a href="${escapeHtml(href)}" rel="noopener">${escapeHtml(block.label)}</a>`

  return `<aside ${attributes.join(' ')}>${heading}${body}${action}</aside>`
}
