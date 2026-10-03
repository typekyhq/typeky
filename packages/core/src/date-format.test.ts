import { describe, expect, it } from 'vitest'
import { isTimeZone } from './date-format'

/**
 * A time zone is checked, not shape-matched.
 *
 * `Intl.DateTimeFormat` throws on a zone it does not know, and a throw at render
 * time is a 500 on every page. That is what makes this a function worth testing:
 * the refusal has to happen where the value is saved, not where it is rendered.
 */

describe('a time zone', () => {
  it.each(['UTC', 'GMT', 'Asia/Shanghai', 'America/New_York', 'Etc/GMT+8', 'America/Argentina/Buenos_Aires'])(
    'accepts %s',
    (zone) => {
      expect(isTimeZone(zone)).toBe(true)
    },
  )

  it('refuses a name that does not exist', () => {
    // The shape is right and the zone is not, which is the case a regular
    // expression alone cannot catch.
    expect(isTimeZone('Mars/Olympus')).toBe(false)
    expect(isTimeZone('Asia/Nowhere')).toBe(false)
  })

  it('refuses an offset', () => {
    // `Intl` takes `+08:00` and Liquid's `date` filter does not, so accepting one
    // here would put the preview and the site in different zones.
    expect(isTimeZone('+08:00')).toBe(false)
    expect(isTimeZone('UTC+8')).toBe(false)
  })

  it('refuses an empty or malformed value', () => {
    expect(isTimeZone('')).toBe(false)
    expect(isTimeZone('Asia/')).toBe(false)
    expect(isTimeZone('/Shanghai')).toBe(false)
    expect(isTimeZone('asia shanghai')).toBe(false)
  })

  it('answers the same thing twice', () => {
    // The render path asks about the same zone on every page, so the answer is
    // remembered; a cache that changed its mind would be worse than none.
    expect(isTimeZone('Europe/Paris')).toBe(true)
    expect(isTimeZone('Europe/Paris')).toBe(true)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
    expect(isTimeZone('Mars/Olympus')).toBe(false)
  })
})
