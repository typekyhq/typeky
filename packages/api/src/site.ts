import { DATE_FORMAT_PATTERN } from '@typeky/core'
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
})

export type AdminSettings = z.infer<typeof adminSettingsSchema>

export const siteSettingsSchema = z.object({
  /** Six hex digits, which is the one shape a colour input produces. */
  accentColor: z.optional(z.string().check(z.regex(/^#[0-9a-fA-F]{6}$/))),
  socialLinks: z.optional(z.array(socialLinkSchema).check(z.maxLength(10))),
  seo: z.optional(
    z.object({
      defaultTitle: z.optional(z.string().check(z.maxLength(120))),
      defaultDescription: z.optional(z.string().check(z.maxLength(300))),
    }),
  ),
  footer: z.optional(z.string().check(z.maxLength(500))),
  /** The language the site is written in, for `<html lang>`. */
  language: z.optional(LANGUAGE),
  /** How the site writes a date. */
  dateFormat: z.optional(DATE_FORMAT),
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
