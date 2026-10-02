import { describe, expect, it } from 'vitest'
import { createLiquidRuntime } from './runtime'

/**
 * The `json_ld` filter.
 *
 * Its whole reason for existing is that `json` escapes the quotes, which turns
 * a `<script type="application/ld+json">` block into text no validator can read.
 * That is what rendering a page found; these are the assertions that keep it
 * found.
 */
describe('json_ld', () => {
  it('keeps the JSON valid, quotes and all', async () => {
    const { render } = createLiquidRuntime()

    const html = await render('{{ data | json_ld }}', { data: { '@type': 'Thing', name: 'A name' } })

    expect(html).toBe('{"@type":"Thing","name":"A name"}')
    expect(JSON.parse(html)).toEqual({ '@type': 'Thing', name: 'A name' })
    // `json` would have produced `&#34;` here, and nothing would parse.
    expect(html).not.toContain('&#34;')
  })

  it('cannot be made to end the script element early', async () => {
    const { render } = createLiquidRuntime()

    const html = await render('{{ data | json_ld }}', {
      data: { headline: '</script><script>alert(1)</script>' },
    })

    // The characters that could close the element are escaped; the JSON stays
    // valid, so the value survives as a string rather than as markup.
    expect(html).not.toContain('</script>')
    expect(html).not.toContain('<script>')
    expect(JSON.parse(html)).toEqual({ headline: '</script><script>alert(1)</script>' })
  })

  it('escapes the ampersand and the line separators too', async () => {
    const { render } = createLiquidRuntime()

    const html = await render('{{ data | json_ld }}', { data: { a: 'x & y', b: '\u2028' } })

    expect(html).not.toContain('&')
    expect(html).not.toContain('\u2028')
    expect(JSON.parse(html)).toEqual({ a: 'x & y', b: '\u2028' })
  })

  it('renders nothing rather than throwing when there is no data', async () => {
    const { render } = createLiquidRuntime()

    expect(await render('{{ missing | json_ld }}', {})).toBe('null')
  })
})
