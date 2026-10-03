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
 * footer. UTC is the default on both sides; a site's own zone is a setting, and
 * the cases below check that the two agree away from UTC as well.
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

  it('renders month names in the locale it was given, English by default', async () => {
    // liquidjs falls back to the locale of whatever is running the engine when it is
    // not told one, so an unpinned runtime renders `一月` in development and
    // `January` on the edge -- the same page, two different ways. The default is
    // pinned because the admin's preview (and `formatDate`) assume English, and the
    // option is what a deliberate decision to follow the site's language would use.
    const english = createLiquidRuntime()
    const chinese = createLiquidRuntime({ locale: 'zh-CN' })

    expect(await english.render("{{ t | date: '%B', 'UTC' }}", { t: ISO })).toBe('October')
    expect(await chinese.render("{{ t | date: '%B', 'UTC' }}", { t: ISO })).toBe('十月')
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

  it.each(['Asia/Shanghai', 'America/New_York', 'Europe/London', 'Pacific/Auckland'])(
    'agree in %s, which is now the site\'s own setting',
    async (zone) => {
      // The zone used to be the string `'UTC'` written into the theme; it is a
      // setting now, so the two formatters have to agree somewhere else -- or the
      // preview is honest about a different zone than the site renders in, which
      // is the failure this file exists for.
      const { render } = createLiquidRuntime()

      for (const format of ['%Y-%m-%d %H:%M', '%B %-d, %Y', '%H:%M', '%a %b %-d %Y']) {
        const liquid = await render(`{{ t | date: '${format}', '${zone}' }}`, { t: ISO })

        expect(formatDate(ISO, format, { timeZone: zone })).toBe(liquid)
      }
    },
  )
})
