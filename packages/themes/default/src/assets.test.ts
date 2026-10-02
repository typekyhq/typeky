import { describe, expect, it } from 'vitest'
import { ASSETS, ASSET_VERSIONS } from './index'
import { BASELINE } from './baseline'

/**
 * The baseline a theme has to meet to be usable, as opposed to merely rendered.
 *
 * These are the assertions behind the "responsive and accessible baseline" part
 * of M6-S6. They are deliberately about the things a person would otherwise have
 * to remember on every edit: a document that declares its language and its
 * colour scheme, a way past the navigation for a keyboard, and a stylesheet that
 * does not throw away focus outlines.
 *
 * String assertions on CSS are weak on their own -- a comment could satisfy one --
 * so the real check is a Lighthouse run against a rendered page. This file is
 * what stops the obvious regression: the rule and the class being deleted
 * altogether, which is the only way it usually happens.
 */

describe('the layout', () => {
  const layout = BASELINE['layouts/base'] ?? ''

  it('declares the language and the viewport', () => {
    expect(layout).toContain('lang="{{ site.language')
    expect(layout).toContain('name="viewport"')
  })

  it('tells the browser both colour schemes are supported', () => {
    // Without this the form controls and scrollbars stay light on a dark page.
    expect(layout).toContain('name="color-scheme"')
    expect(ASSETS['theme.css']?.source).toContain('prefers-color-scheme: dark')
  })

  it('offers a skip link that points at the content it skips to', () => {
    expect(layout).toContain('class="visually-hidden" href="#main"')
    expect(layout).toContain('id="main"')
    // First in the body, because being first is the whole point.
    expect(layout.indexOf('Skip to content')).toBeLessThan(layout.indexOf('snippets/header'))
  })

  it('links the stylesheet through asset_url rather than a hard-coded path', () => {
    // A theme author moves a file; a hard-coded `/theme/...` would not follow.
    expect(layout).toContain("{{ 'theme.css' | asset_url }}")
  })
})

describe('the stylesheet', () => {
  const raw = ASSETS['theme.css']?.source ?? ''
  // Comments removed before asserting, because the comment that *says* not to
  // remove the outline contains the very string the assertion looks for.
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, '')

  it('is shipped at all', () => {
    expect(raw.length).toBeGreaterThan(1000)
    expect(ASSETS['theme.css']?.contentType).toBe('text/css; charset=utf-8')
  })

  it('never removes the focus outline', () => {
    expect(css).toContain(':focus-visible')
    expect(css).not.toMatch(/outline:\s*none/)
  })

  it('honours a request for less motion', () => {
    expect(css).toContain('prefers-reduced-motion')
  })

  it('defines the class the templates use to hide a hint from the eye', () => {
    // The product page's "opens in a new tab" hint is the reason this exists:
    // written without it, the hint was visible to everyone.
    expect(css).toContain('.visually-hidden')
    expect(BASELINE['templates/product']).toContain('class="visually-hidden"')
  })

  it('stacks by default and adds columns only when there is room', () => {
    // Mobile first, which is what makes the narrow layout the one that cannot
    // break: it is the base, not a special case.
    expect(css).toContain('min-width')
    expect(css).toContain('grid-template-columns')
  })
})

describe('the script', () => {
  const js = ASSETS['theme.js']?.source ?? ''

  it('is shipped at all', () => {
    expect(ASSETS['theme.js']?.contentType).toBe('text/javascript; charset=utf-8')
  })

  it('survives storage being unavailable instead of throwing', () => {
    // Private mode and blocked site data both raise rather than return null, and
    // an uncaught error on every page is worse than a notice that cannot remember.
    expect(js).toContain('localStorage')
    expect(js.match(/catch/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
  })
})

describe('versioning', () => {
  it('gives every asset a version, and every version a URL that can change', () => {
    for (const name of Object.keys(ASSETS)) {
      expect(ASSET_VERSIONS[name]).toMatch(/^[0-9a-f]{8}$/)
      // The ETag and the version are two views of one digest, so a deploy that
      // changes the bytes changes both.
      expect(ASSETS[name]?.etag).toContain(ASSET_VERSIONS[name] ?? '')
    }
  })
})
