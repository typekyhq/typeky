import { DATE_FORMAT_DIRECTIVES, formatDate, isDateFormat } from '@typeky/core'
import { describe, expect, it } from 'vitest'
import { createLiquidRuntime } from './runtime'

/**
 * The admin panel's formatter against the theme's.
 *
 * Two implementations of one format string: the site renders with LiquidJS's
 * `date` filter, and the admin renders with `formatDate` from `@typeky/core` so
 * it can show a preview. If they disagree, the settings screen shows a date the
 * site will not produce, which is worse than showing nothing.
 *
 * Every directive is rendered through both and compared, so adding one to the
 * list without teaching both sides about it fails here rather than in somebody's
 * footer. UTC is passed to Liquid because that is what `formatDate` defaults to
 * and what the bundled theme asks for.
 */

const ISO = '2026-10-02T15:04:05.000Z'

/** A time deliberately not midnight, so `%p` and `%I` are not trivially right. */
const MORNING = '2026-01-05T09:07:03.000Z'

describe('the two date formatters', () => {
  it.each(DATE_FORMAT_DIRECTIVES)('agree on %s', async (directive) => {
    const { render } = createLiquidRuntime()

    for (const iso of [ISO, MORNING]) {
      const liquid = await render(`{{ t | date: '${directive}', 'UTC' }}`, { t: iso })

      expect(formatDate(iso, directive, { timeZone: 'UTC' })).toBe(liquid)
    }
  })

  it.each([
    '%Y-%m-%d',
    '%B %-d, %Y',
    '%Y年%-m月%-d日',
    '%H:%M:%S',
    '%I:%M %p',
    '%a %b %-d %Y',
    '%Y/%m/%d %H:%M',
    '%%',
    'published %% %B',
  ])('agree on the whole format %s', async (format) => {
    const { render } = createLiquidRuntime()

    const liquid = await render(`{{ t | date: '${format}', 'UTC' }}`, { t: ISO })

    expect(formatDate(ISO, format, { timeZone: 'UTC' })).toBe(liquid)
  })

  it('refuse the same strings', () => {
    // What one side will not render, the other must not accept either: an unknown
    // directive reaches a reader as `"nd"`, not as an error.
    for (const format of ['%q', '', ' ', '%', '%Y-%q', '100%%%q']) {
      expect(isDateFormat(format)).toBe(false)
    }

    for (const format of ['%Y', '%%', 'no directives at all']) {
      expect(isDateFormat(format)).toBe(true)
    }

    // Whitespace is not a directive problem -- a form trims what is typed into
    // it, and this only answers whether the directives are ones it can render.
    expect(isDateFormat('%Y ')).toBe(true)
  })

  it('renders an unparseable date as nothing, not as Invalid Date', () => {
    expect(formatDate('not a date', '%Y')).toBe('')
    expect(formatDate(null, '%Y')).toBe('')
    expect(formatDate(undefined, '%Y')).toBe('')
  })

  it('defaults to UTC rather than to the machine it runs on', async () => {
    // The reason the theme passes a zone explicitly: a Worker runs in UTC and a
    // laptop does not, so a default of "local" is a date that changes when it is
    // deployed.
    const { render } = createLiquidRuntime()
    const local = await render("{{ t | date: '%H' }}", { t: ISO })

    expect(formatDate(ISO, '%H', { timeZone: 'UTC' })).toBe('15')

    // Only a machine that is not on UTC can show the difference, which is the
    // one that would otherwise ship a surprise.
    if (local !== '15') {
      expect(await render("{{ t | date: '%H', 'UTC' }}", { t: ISO })).toBe('15')
    }
  })
})
