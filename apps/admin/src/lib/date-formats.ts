/**
 * The date formats a site, or the panel, can be set to.
 *
 * A list rather than a text box. The directives are a small language, and a
 * settings screen that asks an operator to learn one is asking them to get it
 * wrong -- the point of the list is that the common shapes are a click, and the
 * preview beside it shows what the click produces.
 *
 * What is stored is still the format string, and the list is not a limit:
 * `withCurrentFormat` keeps a value that is not one of these as a choice of its
 * own, so a site configured before this list existed does not silently become the
 * first option when somebody opens the screen.
 */

/** Shapes a published date is commonly written in. */
export const SITE_DATE_FORMATS: readonly string[] = [
  '%Y-%m-%d',
  '%B %-d, %Y',
  '%-d %B %Y',
  '%b %-d, %Y',
  '%Y年%-m月%-d日',
  '%m/%-d/%Y',
  '%-d/%-m/%Y',
] as const

/** The same for a timestamp in the panel, which usually wants a clock. */
export const ADMIN_DATE_FORMATS: readonly string[] = [
  '%Y-%m-%d %H:%M',
  '%Y-%m-%d %H:%M:%S',
  '%Y-%m-%d',
  '%H:%M',
  '%m/%-d/%Y %H:%M',
  '%Y年%-m月%-d日 %H:%M',
] as const

/**
 * The presets, with the stored value in front when it is not one of them.
 *
 * A `<select>` whose options do not include its value renders the first option
 * instead, and the next save writes that back. Somebody who typed their own format
 * before the list existed would lose it by opening the page.
 */
export function withCurrentFormat(presets: readonly string[], current: string): string[] {
  const value = current.trim()
  if (value === '' || presets.includes(value)) return [...presets]

  return [value, ...presets]
}
