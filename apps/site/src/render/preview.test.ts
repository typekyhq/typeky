import type { DbPort } from '@typeky/platform'
import { createLiquidRuntime, createTemplateLoader } from '@typeky/theme-kit'
import { BASELINE } from '@typeky/theme-default'
import { describe, expect, it } from 'vitest'
import { buildRenderContext } from './context'
import { renderPreview } from './preview'
import { sampleContext } from './sample'
import { renderDocument, themeRuntimeOptions } from './theme-runtime'

/**
 * The preview, against the thing it claims to be.
 *
 * M5-S3's acceptance is that a preview matches what the template renders after
 * being saved. That is only checkable if both go through the same code, so this
 * test renders the same source twice: once as a draft through the preview, and
 * once the way the site will -- a loader reading the stored override -- and
 * compares the two byte for byte.
 *
 * If the preview ever grows its own assembly, this is the test that fails.
 */

const DRAFT = [
  "{% layout 'layouts/base' %}",
  '<article data-marker="draft">',
  '  <h1>{{ content.title }}</h1>',
  '  {{ content.blocks | render_blocks }}',
  '  <p>{{ content.excerpt }}</p>',
  '</article>',
].join('\n')

/** A database that has exactly one override: the draft, as if it had been saved. */
function savedAs(path: string, source: string): DbPort {
  return {
    async all<T>() {
      return [{ path, source }] as T[]
    },
    async first<T>() {
      return null
    },
    async run() {
      return 0
    },
    async batch() {
      return undefined
    },
  }
}

const EMPTY: DbPort = {
  async all() {
    return []
  },
  async first() {
    return null
  },
  async run() {
    return 0
  },
  async batch() {
    return undefined
  },
}

/** The site's own path: the loader reads the override, the runtime renders by name. */
async function renderAsSaved(path: string, source: string, db: DbPort): Promise<string> {
  const loader = createTemplateLoader({ db, theme: 'default', baseline: BASELINE })
  const runtime = createLiquidRuntime({
    ...themeRuntimeOptions(loader.fs),
    cache: false,
  })
  void source

  return renderDocument(runtime, path, sampleContext(path))
}

describe('a preview matches what saving would produce', () => {
  it('renders the same bytes as the saved path, for a template', async () => {
    const db = savedAs('templates/post', DRAFT)

    const preview = await renderPreview({ path: 'templates/post', source: DRAFT, db })
    const saved = await renderAsSaved('templates/post', DRAFT, db)

    expect(preview).toBe(saved)
    // And it is the draft being rendered, not the bundled template.
    expect(preview).toContain('data-marker="draft"')
  })

  it('renders the same bytes for a snippet too', async () => {
    const source = '<p data-marker="card">{{ content.title }}</p>'
    const db = savedAs('snippets/post-card', source)

    expect(await renderPreview({ path: 'snippets/post-card', source, db })).toBe(
      await renderAsSaved('snippets/post-card', source, db),
    )
  })

  it('resolves the rest of the theme, so a fragment is previewed in context', async () => {
    const html = await renderPreview({ path: 'templates/post', source: DRAFT, db: EMPTY })

    // The draft declares a layout and the layout renders the header, which is
    // the difference between previewing a template and previewing a fragment.
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('site-header')
    expect(html).toContain('Sample Site')
  })

  it('renders the sample data, not the site’s real content', async () => {
    const html = await renderPreview({ path: 'templates/post', source: DRAFT, db: EMPTY })

    expect(html).toContain('Sample post 1')
    expect(html).toContain('A short summary')
    // Blocks were rendered by `render_blocks`, not left as JSON.
    expect(html).toContain('<p>This is a sample paragraph')
    expect(html).not.toContain('&lt;p&gt;')
    expect(html).not.toContain('"type":"paragraph"')
  })

  it('marks the context as a preview rather than the real page', () => {
    // A template can tell, so it can avoid emitting a canonical URL for a page
    // that does not exist.
    expect(sampleContext('templates/post').preview).toBe(true)
    expect(
      buildRenderContext({
        site: { name: 'x', tagline: null, logoMediaId: null, settings: {}, nav: [] },
        item: { kind: 'post', title: 'x', slug: 'x', blocks: [], seo: {} },
      }).preview,
    ).toBeUndefined()
  })

  it('never lets the sample data come from the database', async () => {
    // The db is for other overrides only. If it ever supplied content, a preview
    // would depend on which post happened to be newest.
    const html = await renderPreview({ path: 'templates/post', source: DRAFT, db: EMPTY })

    expect(html).toContain('Sample post 1')
    expect(html).not.toContain('Hello Typeky')
  })
})

describe('one assembly, not two', () => {
  it('builds the context the preview uses', () => {
    // Named so the coupling is visible: the preview calls this function, and so
    // will the site's render. A second implementation would be the bug the
    // acceptance criterion is about.
    const context = buildRenderContext({
      site: { name: 'Site', tagline: null, logoMediaId: null, settings: {}, nav: [] },
      item: {
        kind: 'post',
        title: 'Title',
        slug: 'a-post',
        blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
        seo: {},
      },
      baseUrl: 'https://example.com',
    })

    expect(context.page.url).toBe('/posts/a-post')
    expect(context.page.canonical).toBe('https://example.com/posts/a-post')
    expect(context.seo.title).toBe('Title')
    expect(context.content).toMatchObject({ blocks: [{ type: 'paragraph' }] })
  })

  it('lets an override win over the excerpt, which wins over the site default', () => {
    const base = {
      site: { name: 'Site', tagline: null, logoMediaId: null, settings: {}, nav: [] },
      defaults: { title: 'Site default', description: 'Site default description' },
    }
    const item = { kind: 'post' as const, title: 'Title', slug: 'x', blocks: [], seo: {} }

    expect(buildRenderContext({ ...base, item }).seo.description).toBe('Site default description')
    expect(buildRenderContext({ ...base, item: { ...item, excerpt: 'Excerpt' } }).seo.description).toBe('Excerpt')
    expect(
      buildRenderContext({ ...base, item: { ...item, seo: { description: 'Author wrote this' } } }).seo.description,
    ).toBe('Author wrote this')
  })
})
