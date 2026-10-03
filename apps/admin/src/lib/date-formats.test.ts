import { DEFAULT_ADMIN_DATE_FORMAT, DEFAULT_DATE_FORMAT, isDateFormat } from '@typeky/core'
import { describe, expect, it } from 'vitest'
import { ADMIN_DATE_FORMATS, SITE_DATE_FORMATS, withCurrentFormat } from './date-formats'

/**
 * The formats the settings screen offers.
 *
 * A list of presets is only an improvement on a text box if every one of them
 * actually renders: a preset the platform refuses would be an option that fails on
 * save, which is worse than the field it replaced.
 */

describe('the date format presets', () => {
  it.each(SITE_DATE_FORMATS)('offers a site format the platform renders: %s', (format) => {
    expect(isDateFormat(format)).toBe(true)
  })

  it.each(ADMIN_DATE_FORMATS)('offers a panel format the platform renders: %s', (format) => {
    expect(isDateFormat(format)).toBe(true)
  })

  it('includes the default, so the field opens on something', () => {
    // The form shows the default when nothing has been chosen, and a `<select>`
    // cannot show a value that is not one of its options.
    expect(SITE_DATE_FORMATS).toContain(DEFAULT_DATE_FORMAT)
    expect(ADMIN_DATE_FORMATS).toContain(DEFAULT_ADMIN_DATE_FORMAT)
  })
})

describe('the options a format field offers', () => {
  it('is the presets when nothing has been chosen', () => {
    expect(withCurrentFormat(['a', 'b'], '')).toEqual(['a', 'b'])
  })

  it('is the presets when the chosen one is among them', () => {
    expect(withCurrentFormat(['a', 'b'], 'b')).toEqual(['a', 'b'])
  })

  it('puts a value that is not among them in front', () => {
    // Otherwise the field renders the first option as if it were the value, and the
    // next save writes that back -- which is how somebody who typed a format before
    // the list existed would lose it by opening the page.
    expect(withCurrentFormat(['a', 'b'], '%d.%m.%Y')).toEqual(['%d.%m.%Y', 'a', 'b'])
  })

  it('ignores whitespace around the stored value', () => {
    expect(withCurrentFormat(['a', 'b'], ' b ')).toEqual(['a', 'b'])
  })
})
