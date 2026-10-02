import { describe, expect, it } from 'vitest'
import { attributionFor, ATTRIBUTION, injectAttribution, TYPEKY_URL } from './attribution'

/**
 * The badge, and the two engines that decide whether it is on the page.
 *
 * The theme renders it. The platform puts it back when the theme did not. Both
 * behaviours are asserted here because they are one promise made twice: a free
 * deployment says where it came from, and a paid one does not.
 */

describe('whether there is a badge at all', () => {
  it('is there for an unlicensed deployment', () => {
    expect(attributionFor({ whiteLabel: false })).toEqual(ATTRIBUTION)
  })

  it('is absent -- not blank -- once a licence removes it', () => {
    // `undefined` rather than a filled-in object with an empty text: a template
    // rendering a blank anchor would be a badge that looks like a mistake.
    expect(attributionFor({ whiteLabel: true })).toBeUndefined()
  })

  it('points at the product site over https', () => {
    expect(TYPEKY_URL.startsWith('https://')).toBe(true)
    expect(ATTRIBUTION.text).toBe('Powered by Typeky')
  })
})

const PAGE = '<!doctype html><html><body><main>Content</main></body></html>'

describe('putting the badge back', () => {
  it('does nothing when a licence removed it', () => {
    expect(injectAttribution(PAGE, undefined)).toBe(PAGE)
  })

  it('does nothing when the theme already rendered it', () => {
    const themed = '<body><footer><a data-typeky-attribution href="x">Powered by Typeky</a></footer></body>'

    expect(injectAttribution(themed, ATTRIBUTION)).toBe(themed)
  })

  it('inserts before the closing body tag, which is where a footer belongs', () => {
    const html = injectAttribution(PAGE, ATTRIBUTION)

    expect(html).toContain('data-typeky-attribution')
    expect(html.indexOf('data-typeky-attribution')).toBeLessThan(html.indexOf('</body>'))
    expect(html.indexOf('Content')).toBeLessThan(html.indexOf('data-typeky-attribution'))
  })

  it('matches the closing tag whatever its case', () => {
    const html = injectAttribution('<html><BODY>x</BODY></HTML>', ATTRIBUTION)

    expect(html).toContain('x<p class="attribution">')
  })

  it('appends rather than failing on a fragment with no body', () => {
    // A template that renders a fragment is a template nobody checked, and a page
    // should not 500 over it.
    const html = injectAttribution('<main>Content</main>', ATTRIBUTION)

    expect(html.endsWith('</a></p>')).toBe(true)
    expect(html).toContain('data-typeky-attribution')
  })

  it('carries rel=noopener and never nofollow', () => {
    const html = injectAttribution(PAGE, ATTRIBUTION)

    expect(html).toContain('rel="noopener"')
    expect(html).not.toContain('nofollow')
  })

  it('escapes what it writes, even though the constant is ours', () => {
    // The URL and the text are constants today. Escaping them is what keeps that
    // from being load-bearing if either ever becomes configurable.
    const html = injectAttribution(PAGE, { text: 'A & B', url: 'https://example.com/?a=1&b="2"' })

    expect(html).toContain('A &amp; B')
    expect(html).not.toContain('a=1&b=')
  })
})
