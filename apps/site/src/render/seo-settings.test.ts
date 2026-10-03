import { describe, expect, it } from 'vitest'
import { robotsRules, seoDefaults, seoImageId, seoTitleTemplate } from './seo-settings'

/**
 * Reading `settings.seo`.
 *
 * The site document is validated on write and read back later, possibly by a
 * different build. Every reader here has to answer with the default for a shape it
 * does not recognise -- a page that 500s because a JSON column holds what an older
 * version wrote is the failure this module exists to prevent.
 */

describe('reading the seo settings', () => {
  it('answers with nothing for a row it does not recognise', () => {
    expect(seoDefaults({})).toEqual({})
    expect(seoImageId({})).toBeUndefined()
    expect(seoTitleTemplate({})).toBeUndefined()
    expect(robotsRules({})).toEqual({ noindex: false, disallowPaths: [] })

    expect(seoDefaults({ seo: null })).toEqual({})
    expect(seoDefaults({ seo: 'nonsense' })).toEqual({})
    expect(robotsRules({ seo: { robots: 'nonsense' } })).toEqual({ noindex: false, disallowPaths: [] })
  })

  it('reads the title and description defaults', () => {
    const settings = { seo: { defaultTitle: 'Title', defaultDescription: 'Description' } }

    expect(seoDefaults(settings)).toEqual({ title: 'Title', description: 'Description' })
  })

  it('treats an empty string as not set', () => {
    // A field somebody opened and left blank is not a template, and it is not an
    // image: it is the same as never having set one.
    expect(seoTitleTemplate({ seo: { titleTemplate: '' } })).toBeUndefined()
    expect(seoImageId({ seo: { defaultOgImageMediaId: '' } })).toBeUndefined()
  })

  it('trims the disallow list and drops the blanks', () => {
    const rules = robotsRules({ seo: { robots: { disallowPaths: [' /search ', '', '  ', '/cart'] } } })

    expect(rules).toEqual({ noindex: false, disallowPaths: ['/search', '/cart'] })
  })

  it('only believes an explicit true', () => {
    expect(robotsRules({ seo: { robots: { noindex: true } } }).noindex).toBe(true)
    // Anything that is not the boolean is not a decision, and guessing at a string
    // would make a typo in the JSON decide whether the site is indexed.
    expect(robotsRules({ seo: { robots: { noindex: 'yes' } } }).noindex).toBe(false)
  })
})
