import { blockToHtml, type Block } from '@typeky/core'
import { describe, expect, it } from 'vitest'
import { createLiquidRuntime } from './runtime'

describe('asset_url', () => {
  it('prefixes the asset base path', async () => {
    const { render } = createLiquidRuntime()

    expect(await render("{{ 'styles.css' | asset_url }}")).toBe('/theme/styles.css')
  })

  it('tolerates a leading slash, which is how themes write it', async () => {
    const { render } = createLiquidRuntime()

    expect(await render("{{ '/images/logo.svg' | asset_url }}")).toBe('/theme/images/logo.svg')
  })

  it('accepts a custom base path and normalises the slashes', async () => {
    const { render } = createLiquidRuntime({ assetBasePath: 'assets' })

    expect(await render("{{ 'app.js' | asset_url }}")).toBe('/assets/app.js')
  })

  it('adds the content hash when one is known', async () => {
    const { render } = createLiquidRuntime({ assetVersions: { 'theme.css': 'abc12345' } })

    // The URL changes when the bytes do, which is what lets the route answer
    // with an immutable cache header instead of a short expiry.
    expect(await render("{{ 'theme.css' | asset_url }}")).toBe('/theme/theme.css?v=abc12345')
  })

  it('leaves an unknown asset unversioned rather than guessing', async () => {
    const { render } = createLiquidRuntime({ assetVersions: { 'theme.css': 'abc12345' } })

    expect(await render("{{ 'print.css' | asset_url }}")).toBe('/theme/print.css')
  })
})

describe('money', () => {
  it('formats integer cents', async () => {
    const { render } = createLiquidRuntime()

    expect(await render('{{ 1234 | money }}')).toBe('$12.34')
  })

  it('accepts an amount that arrived as a string', async () => {
    const { render } = createLiquidRuntime()

    expect(await render('{{ amount | money }}', { amount: '19900' })).toBe('$199.00')
  })

  it('renders empty for something that is not a number', async () => {
    const { render } = createLiquidRuntime()

    expect(await render('[{{ label | money }}]', { label: 'From 199 USD' })).toBe('[]')
  })

  it('honours the configured currency and locale', async () => {
    const { render } = createLiquidRuntime({ currency: 'EUR', locale: 'de-DE' })

    expect(await render('{{ 1234 | money }}')).toContain('12,34')
  })
})

describe('t', () => {
  it('looks a key up in the dictionary', async () => {
    const { render } = createLiquidRuntime({ translations: { 'nav.blog': 'Blog' } })

    expect(await render("{{ 'nav.blog' | t }}")).toBe('Blog')
  })

  it('falls back to the key, so a missing string is visible on the page', async () => {
    const { render } = createLiquidRuntime()

    expect(await render("{{ 'nav.missing' | t }}")).toBe('nav.missing')
  })

  it('escapes the translated value like any other output', async () => {
    const { render } = createLiquidRuntime({ translations: { heading: '<b>x</b>' } })

    expect(await render("{{ 'heading' | t }}")).toBe('&lt;b&gt;x&lt;/b&gt;')
  })
})

describe('render_blocks', () => {
  it('fails loudly while blockToHtml is not wired', async () => {
    const { render } = createLiquidRuntime()

    await expect(render('{{ blocks | render_blocks }}', { blocks: [] })).rejects.toThrow(
      /not wired yet/,
    )
  })

  it('emits the renderer output without escaping it again', async () => {
    const { render } = createLiquidRuntime({ renderBlocks: () => '<p>Body</p>' })

    expect(await render('{{ blocks | render_blocks }}', { blocks: [{ type: 'paragraph' }] })).toBe(
      '<p>Body</p>',
    )
  })

  it('passes the blocks through to the renderer', async () => {
    const seen: unknown[] = []
    const { render } = createLiquidRuntime({
      renderBlocks: (blocks) => {
        seen.push(blocks)
        return ''
      },
    })

    const blocks = [{ type: 'paragraph', text: 'hi' }]
    await render('{{ blocks | render_blocks }}', { blocks })

    expect(seen).toEqual([blocks])
  })

  it('is reachable through an assign, and then gets escaped again', async () => {
    const { render } = createLiquidRuntime({ renderBlocks: () => '<p>Body</p>' })

    expect(
      await render('{% assign html = blocks | render_blocks %}{{ html }}', { blocks: [] }),
    ).toBe('&lt;p&gt;Body&lt;/p&gt;')
  })

  it('works with the real producer, which is what the runtime is wired to in practice', async () => {
    // Closes the loop between this filter and `blockToHtml`: the filter takes an
    // injected renderer precisely so the site Worker can supply it without
    // pulling the editor in (architecture section 3.11).
    const { render } = createLiquidRuntime({
      renderBlocks: (blocks) => blockToHtml(blocks as Block[]),
    })

    const blocks: Block[] = [
      { type: 'heading', level: 2, content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Body' }] },
    ]

    expect(await render('{{ blocks | render_blocks }}', { blocks })).toBe('<h2>Title</h2><p>Body</p>')
  })

  it('escapes nothing the producer already escaped', async () => {
    const { render } = createLiquidRuntime({
      renderBlocks: (blocks) => blockToHtml(blocks as Block[]),
    })

    const blocks: Block[] = [
      { type: 'paragraph', content: [{ type: 'text', text: '<script>alert(1)</script>' }] },
    ]

    const html = await render('{{ blocks | render_blocks }}', { blocks })

    expect(html).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(html).not.toContain('<script>')
  })
})
