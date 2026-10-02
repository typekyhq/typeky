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

  it('escapes again when the result is assigned first, because raw applies only to the last filter of an output', async () => {
    const { render } = createLiquidRuntime({ renderBlocks: () => '<p>Body</p>' })

    expect(
      await render('{% assign html = blocks | render_blocks %}{{ html }}', { blocks: [] }),
    ).toBe('&lt;p&gt;Body&lt;/p&gt;')
  })
})
