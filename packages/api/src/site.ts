import { DATE_FORMAT_PATTERN, TIME_ZONE_PATTERN, isTimeZone } from '@typeky/core'
import { isAdminPathSegment } from './paths'
import * as z from 'zod/mini'

/**
 * The site document.
 *
 * The settings and navigation blobs are JSON columns, so they need a schema
 * whatever else happens. Keeping it here means the admin form validates with the
 * same one the Worker does, and the paths it reports line up with the fields the
 * form renders.
 *
 * Bounds are deliberately generous: this is not where a value is judged for
 * taste, only where it is refused for being the wrong shape or absurdly long.
 */

const LABEL = z.string().check(z.minLength(1), z.maxLength(60))
const HREF = z.string().check(z.minLength(1), z.maxLength(500))

export const navItemSchema = z.object({
  label: LABEL,
  /** A site-relative path or an absolute URL. */
  href: HREF,
  /** Position in the menu; the list is sorted by it. */
  order: z.number().check(z.int(), z.minimum(0), z.maximum(999)),
})

export type NavItem = z.infer<typeof navItemSchema>

export const socialLinkSchema = z.object({ label: LABEL, href: HREF })

export type SocialLink = z.infer<typeof socialLinkSchema>

/**
 * A BCP 47 language tag, loosely.
 *
 * `en`, `zh-CN`, `pt-BR`. Validated for shape rather than against a registry:
 * the tag goes into `<html lang>` and into a `Content-Language`, and a browser
 * or a crawler is the thing that decides whether it knows the language.
 */
const LANGUAGE = z.string().check(z.minLength(2), z.maxLength(35), z.regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i))

/**
 * A date format, checked against the directives the platform can render.
 *
 * The same pattern the preview formatter and the theme's `| date:` filter are
 * held to, from `@typeky/core`. An unknown directive has to be refused here,
 * because Liquid renders one as `"nd"` rather than failing -- a typo would
 * otherwise reach a reader as a plausible-looking date.
 */
const DATE_FORMAT = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(60),
    // A message, because the default one quotes a regular expression at the
    // operator. What they can act on is the list of directives.
    z.regex(DATE_FORMAT_PATTERN, 'use only the listed directives, for example %Y-%m-%d'),
  )

/** Settings that belong to the admin panel rather than to the site. */
export const adminSettingsSchema = z.object({
  /** Which language file the panel reads. */
  language: z.optional(LANGUAGE),
  /** How the panel writes a timestamp. */
  dateFormat: z.optional(DATE_FORMAT),
  /**
   * The URL segment the panel is served from.
   *
   * A fixed `/admin` is the first thing a scanner tries. This is the operator's
   * answer to that -- one segment, so `/<path>` is the panel and `/<path>/settings`
   * is a screen in it.
   */
  path: z.optional(
    z.string().check(
      z.refine(
        isAdminPathSegment,
        'lower-case letters, digits and hyphens; not an address the platform uses',
      ),
    ),
  ),
})

export type AdminSettings = z.infer<typeof adminSettingsSchema>

/**
 * A time zone, checked against what the runtime can actually render.
 *
 * Two checks rather than one, and both are needed: the pattern refuses an offset
 * like `+08:00`, which `Intl` accepts and Liquid's `date` filter does not, while
 * `isTimeZone` refuses a name that looks right and does not exist. A bad zone that
 * got through would not be a bad date -- `Intl.DateTimeFormat` throws, and every
 * page becomes a 500.
 */
const TIME_ZONE = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(64),
    z.regex(TIME_ZONE_PATTERN, 'use an IANA time zone, for example Asia/Shanghai'),
    z.refine(isTimeZone, 'use an IANA time zone, for example Asia/Shanghai'),
  )

/**
 * A key an operator can reach from a template.
 *
 * Lower snake case so `site.settings.custom.contact_email` parses as one name in
 * Liquid: a dotted path is split on dots, and a key with a dot, a space or a
 * capital in it would only be reachable by a bracket expression nobody writes.
 */
const CUSTOM_KEY = z
  .string()
  .check(
    z.minLength(1),
    z.maxLength(40),
    z.regex(
      /^[a-z][a-z0-9_]*$/,
      'lower-case letters, digits and underscores, starting with a letter',
    ),
  )

/**
 * One key and its value.
 *
 * A list rather than an object, because an operator edits a list: an object has no
 * order, and a form that reorders itself between saves is a form that loses things.
 */
export const customSettingSchema = z.object({
  key: CUSTOM_KEY,
  value: z.string().check(z.maxLength(500)),
})

export type CustomSetting = z.infer<typeof customSettingSchema>

/**
 * Robots rules the operator adds on top of the platform's own.
 *
 * The platform's rules are not here because they are not preferences: `/admin` and
 * `/api/` are disallowed whether or not anybody thinks about it. This is the other
 * half -- "do not index the site yet" and "keep this path out" -- which is a
 * judgment only the operator can make.
 */
export const robotsSettingsSchema = z.object({
  /** Discourage every crawler: `noindex` on each page, `Disallow: /` in robots.txt. */
  noindex: z.optional(z.boolean()),
  /** Extra `Disallow:` lines, one path each. */
  disallowPaths: z.optional(z.array(z.string().check(z.maxLength(200))).check(z.maxLength(100))),
})

export type RobotsSettings = z.infer<typeof robotsSettingsSchema>

export const seoDefaultsSchema = z.object({
  defaultTitle: z.optional(z.string().check(z.maxLength(120))),
  defaultDescription: z.optional(z.string().check(z.maxLength(300))),
  /**
   * The share image a page without one of its own uses.
   *
   * A media id, like every other image the site references: a theme is given a URL
   * to print rather than an id it would have to resolve.
   */
  defaultOgImageMediaId: z.optional(z.nullable(z.string())),
  /**
   * How the site's name joins a page title, e.g. `%s · Example`.
   *
   * Required to contain `%s` when it is set: a template without it is not a
   * template, it is a site name that replaced every title.
   */
  titleTemplate: z.optional(
    z
      .string()
      .check(
        z.maxLength(120),
        z.refine((value) => value.includes('%s'), 'include %s where the page title goes'),
      ),
  ),
  robots: z.optional(robotsSettingsSchema),
})

export type SeoDefaults = z.infer<typeof seoDefaultsSchema>

export const siteSettingsSchema = z.object({
  /** Six hex digits, which is the one shape a colour input produces. */
  accentColor: z.optional(z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/))),
  socialLinks: z.optional(z.array(socialLinkSchema).check(z.maxLength(10))),
  seo: z.optional(seoDefaultsSchema),
  footer: z.optional(z.string().check(z.maxLength(500))),
  /** The language the site is written in, for `<html lang>`. */
  language: z.optional(LANGUAGE),
  /** How the site writes a date. */
  dateFormat: z.optional(DATE_FORMAT),
  /** The zone those dates are written in. Defaults to `UTC` when unset. */
  timezone: z.optional(TIME_ZONE),
  /**
   * Keys and values the operator invents, for their templates to read.
   *
   * The list is what makes the theme contract finite: without it, every value a
   * theme wants that the platform did not think of is a template edited by hand, or
   * a new field in this schema. Duplicates are refused here because the object the
   * template sees would silently keep only one of them.
   */
  custom: z.optional(
    z.array(customSettingSchema).check(
      z.maxLength(30),
      z.refine(
        (entries) => new Set(entries.map((entry) => entry.key)).size === entries.length,
        'keys must be unique',
      ),
    ),
  ),
  /**
   * Paths the operator wants kept free for something else, one entry each.
   *
   * The platform's own paths are reserved without being listed here -- they are a
   * fact about the Worker rather than a preference. This is for the URL somebody
   * knows they will need: an installer, a shop, a booking flow.
   */
  reservedPaths: z.optional(z.array(z.string().check(z.maxLength(200))).check(z.maxLength(100))),
  /** The panel's own language and dates, which are not the site's. */
  admin: z.optional(adminSettingsSchema),
})

export type SiteSettings = z.infer<typeof siteSettingsSchema>

/**
 * A whole document, not a patch.
 *
 * The repository writes what it is given, so a field the form does not edit has
 * to be sent back unchanged rather than omitted. The admin keeps the loaded
 * document in state for exactly that reason.
 */
export const siteWriteSchema = z.object({
  name: z.string().check(z.minLength(1), z.maxLength(120)),
  tagline: z.optional(z.nullable(z.string().check(z.maxLength(200)))),
  logoMediaId: z.optional(z.nullable(z.string())),
  faviconMediaId: z.optional(z.nullable(z.string())),
  theme: z.string().check(z.minLength(1), z.maxLength(60)),
  settings: siteSettingsSchema,
  nav: z.array(navItemSchema).check(z.maxLength(20)),
})

export type SiteWrite = z.infer<typeof siteWriteSchema>

export const siteResponseSchema = z.object({
  name: z.string(),
  tagline: z.nullable(z.string()),
  logoMediaId: z.nullable(z.string()),
  faviconMediaId: z.nullable(z.string()),
  theme: z.string(),
  settings: siteSettingsSchema,
  nav: z.array(navItemSchema),
  /** ISO 8601 UTC. */
  updatedAt: z.string(),
})

export type SiteResponse = z.infer<typeof siteResponseSchema>
