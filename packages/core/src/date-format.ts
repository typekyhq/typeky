/**
 * The date format a site or an admin panel may be configured with.
 *
 * A **strftime** subset, and a deliberately small one, for two measured reasons:
 *
 *   - LiquidJS renders an unknown directive rather than failing. `%q` comes out
 *     as `"nd"`, so a typo produces something that looks like a date and nobody
 *     notices until a reader does. The format string is therefore checked when it
 *     is saved (`isDateFormat`) instead of being trusted.
 *   - The admin panel has to render the same string the theme does, and the two
 *     agreeing is the whole point of showing a preview. Everything here is
 *     implemented on both sides from the same list, and a test renders every
 *     directive through Liquid and through `formatDate` to prove they match.
 *
 * Names are English and digits are ASCII on both sides, and that is enforced rather
 * than assumed: the theme's runtime is pinned to `en-US` (see `LiquidRuntimeOptions`),
 * because liquidjs otherwise falls back to the locale of whatever is running it. A
 * format string that means one thing in the admin and another on the site would make
 * the preview a lie -- and making month names follow the site's language is a change
 * to the theme contract, not a change to a setting.
 */

/** Every directive a configured format may use, longest first where they overlap. */
export const DATE_FORMAT_DIRECTIVES = [
  '%Y',
  '%y',
  '%m',
  '%-m',
  '%d',
  '%-d',
  '%B',
  '%b',
  '%A',
  '%a',
  '%H',
  '%I',
  '%M',
  '%S',
  '%p',
  '%%',
] as const

/** What a published date looks like when nobody has chosen. */
export const DEFAULT_DATE_FORMAT = '%B %-d, %Y'

/** What a timestamp looks like in the admin when nobody has chosen. */
export const DEFAULT_ADMIN_DATE_FORMAT = '%Y-%m-%d %H:%M'

/**
 * The zone a site renders in when nobody has chosen one.
 *
 * `UTC` because that is what a Worker runs in: the default is then what a deployed
 * site shows rather than what the machine developing it happens to be set to.
 */
export const DEFAULT_TIME_ZONE = 'UTC'

/** Long enough for a date and a time, short enough to stay a setting. */
const MAX_LENGTH = 60

/**
 * The whole language of a format string, as one pattern.
 *
 * Built from the list above rather than written out again, so the schema that
 * validates a save and the function that renders a preview cannot disagree about
 * what is allowed. Longest first: `%-m` starts with `%m`, and alternation takes
 * the first branch that matches. `%` is not special in a regular expression, so
 * the directives go in as they are. The lookahead rejects a value that is nothing
 * but whitespace, which would render as nothing and looks like an empty field
 * somebody forgot to fill in.
 */
export const DATE_FORMAT_PATTERN = new RegExp(
  `^(?!\\s*$)(?:[^%]|${[...DATE_FORMAT_DIRECTIVES]
    .sort((left, right) => right.length - left.length)
    .join('|')})*$`,
)

/**
 * Whether a format string is one this platform will render.
 *
 * Refusing is the point: a format that half-works is worse than one that is
 * rejected, because the failure is a plausible-looking date. Whitespace around
 * the value is not a directive problem -- a form trims what is typed into it.
 */
export function isDateFormat(value: string): boolean {
  return value.length > 0 && value.length <= MAX_LENGTH && DATE_FORMAT_PATTERN.test(value)
}

/**
 * The shape a named time zone has.
 *
 * `UTC`, `Asia/Shanghai`, `America/Argentina/Buenos_Aires`. A shape rather than a
 * list, because the list is `Intl`'s and it changes with the runtime -- what this
 * rejects is the thing that is not a zone name at all. An offset such as `+08:00`
 * is the one worth naming: `Intl` accepts it, and Liquid's own `date` filter does
 * not, so the preview and the site would disagree about the same instant.
 */
export const TIME_ZONE_PATTERN = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/

/**
 * Whether a string is a time zone this runtime can render in.
 *
 * Asked of `Intl` rather than checked against a list: a zone that does not exist
 * makes `Intl.DateTimeFormat` throw, and a throw at render time is a 500 on every
 * page. The refusal has to happen when the value is saved, which is what this is
 * for.
 *
 * Answers are remembered, because the render path asks the same question about the
 * same zone on every page: the first call builds a formatter, and after that it is
 * a lookup. Nothing goes in the set that has not been proven, so a bad value is
 * simply refused again.
 */
const KNOWN_TIME_ZONES = new Set<string>()

export function isTimeZone(value: string): boolean {
  if (!TIME_ZONE_PATTERN.test(value)) return false
  if (KNOWN_TIME_ZONES.has(value)) return true

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value })
    KNOWN_TIME_ZONES.add(value)
    return true
  } catch {
    return false
  }
}

export interface FormatDateOptions {
  /**
   * IANA zone. Defaults to `UTC`, which is what a Worker runs in -- so the
   * default is what a deployed site shows rather than what the machine developing
   * it happens to be set to. Pass the resolved zone to show an operator their own
   * clock.
   */
  timeZone?: string
}

interface Formatters {
  numeric: Intl.DateTimeFormat
  clock: Intl.DateTimeFormat
  monthLong: Intl.DateTimeFormat
  monthShort: Intl.DateTimeFormat
  monthNumeric: Intl.DateTimeFormat
  dayNumeric: Intl.DateTimeFormat
  weekdayLong: Intl.DateTimeFormat
  weekdayShort: Intl.DateTimeFormat
}

// Built once per zone: constructing a formatter is the expensive part, and a list
// page formats one date per row.
const FORMATTERS = new Map<string, Formatters>()

function formattersFor(timeZone: string): Formatters {
  const existing = FORMATTERS.get(timeZone)
  if (existing !== undefined) return existing

  // `en-US` fixes the names and the digits, which is what strftime does and what
  // the theme's `date` filter produces. The zone is the only thing that varies.
  const built: Formatters = {
    numeric: new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }),
    clock: new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h12',
    }),
    monthLong: new Intl.DateTimeFormat('en-US', { timeZone, month: 'long' }),
    monthShort: new Intl.DateTimeFormat('en-US', { timeZone, month: 'short' }),
    // `numeric` rather than stripping a leading zero from the padded form:
    // stripping is a string operation that assumes ASCII padding.
    monthNumeric: new Intl.DateTimeFormat('en-US', { timeZone, month: 'numeric' }),
    dayNumeric: new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric' }),
    weekdayLong: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }),
    weekdayShort: new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }),
  }

  FORMATTERS.set(timeZone, built)

  return built
}

function partOf(formatter: Intl.DateTimeFormat, date: Date, type: string): string {
  return formatter.formatToParts(date).find((part) => part.type === type)?.value ?? ''
}

/** Anything unparseable formats as nothing, rather than as "Invalid Date". */
function asDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * The same directives LiquidJS renders, rendered here.
 *
 * The admin panel needs this because it formats dates too, and a preview is only
 * useful if it is the same formatter. `format` is assumed to have passed
 * `isDateFormat`; an unrecognised directive is left as written rather than
 * dropped, because losing half a format silently is the failure mode this whole
 * module exists to avoid.
 */
export function formatDate(value: string | Date | null | undefined, format: string, options: FormatDateOptions = {}): string {
  if (value === null || value === undefined) return ''

  const date = asDate(value)
  if (date === null) return ''

  const timeZone = options.timeZone ?? 'UTC'
  const formatters = formattersFor(timeZone)

  let output = ''

  for (let index = 0; index < format.length; index += 1) {
    if (format[index] !== '%') {
      output += format[index]
      continue
    }

    // Longest first. `%-m` and `%-d` are the only three-character directives, and
    // a two-character read of them would silently become `%` followed by `-`.
    const three = format.slice(index, index + 3)
    const directive = three === '%-m' || three === '%-d' ? three : format.slice(index, index + 2)

    switch (directive) {
      case '%-m':
        output += formatters.monthNumeric.format(date)
        break
      case '%-d':
        output += formatters.dayNumeric.format(date)
        break
      case '%Y':
        output += partOf(formatters.numeric, date, 'year')
        break
      case '%y':
        output += partOf(formatters.numeric, date, 'year').slice(-2)
        break
      case '%m':
        output += partOf(formatters.numeric, date, 'month')
        break
      case '%d':
        output += partOf(formatters.numeric, date, 'day')
        break
      case '%B':
        output += formatters.monthLong.format(date)
        break
      case '%b':
        output += formatters.monthShort.format(date)
        break
      case '%A':
        output += formatters.weekdayLong.format(date)
        break
      case '%a':
        output += formatters.weekdayShort.format(date)
        break
      case '%H':
        output += partOf(formatters.numeric, date, 'hour')
        break
      case '%I':
        output += partOf(formatters.clock, date, 'hour')
        break
      case '%M':
        output += partOf(formatters.clock, date, 'minute')
        break
      case '%S':
        output += partOf(formatters.clock, date, 'second')
        break
      case '%p':
        output += partOf(formatters.clock, date, 'dayPeriod')
        break
      case '%%':
        output += '%'
        break
      default:
        output += format[index]
        break
    }

    index += directive.length - 1
  }

  return output
}
