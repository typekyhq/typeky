import { describe, expect, it } from 'vitest'
import { injectRobotsMeta } from './robots'

/**
 * The noindex tag, put in by the platform.
 *
 * This is a promise the theme cannot be trusted to keep: a deployment edits its
 * templates, and "do not index this" is not a preference somebody gets to delete
 * by accident.
 */

const PAGE = '<!doctype html><html><head><title>x</title></head><body>hi</body></html>'

describe('injecting the noindex tag', () => {
  it('puts it in the head', () => {
    const html = injectRobotsMeta(PAGE, true)

    expect(html).toContain('<meta name="robots" content="noindex, nofollow">')
    // In the head, not at the end: a crawler reads either, but a document that
    // says one thing in its head and another at its foot is a document nobody can
    // reason about.
    expect(html.indexOf('name="robots"')).toBeLessThan(html.indexOf('</head>'))
  })

  it('leaves a page that already says something about robots alone', () => {
    const own = PAGE.replace('</head>', '<meta name="robots" content="index, follow"></head>')

    expect(injectRobotsMeta(own, true)).toBe(own)
  })

  it('does nothing when the site has not asked', () => {
    expect(injectRobotsMeta(PAGE, false)).toBe(PAGE)
    expect(injectRobotsMeta(PAGE, undefined)).toBe(PAGE)
  })

  it('still says it without a head', () => {
    // A page whose source is its own document need not have one. Somewhere in the
    // document beats nowhere, because the setting is a request not to be found.
    const bare = '<html><body>hi</body></html>'

    expect(injectRobotsMeta(bare, true)).toContain('name="robots"')
  })
})
