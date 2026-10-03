/**
 * Reading the `settings.seo` bag without trusting it.
 *
 * The site document is validated when it is written and read back later, possibly
 * by a different build. A row written before a field existed, or edited by hand,
 * must not turn a page into a 500 -- so every reader here answers with the default
 * for a shape it does not recognise rather than reaching into it.
 *
 * One module for the three callers: the page context, the sitemap's robots rules,
 * and the robots.txt route. They read the same bag, and three readers would
 * eventually disagree about what a missing value means.
 */

export interface RobotsRules {
  /** Discourage every crawler, site-wide. */
  noindex: boolean
  /** Extra paths to disallow, already trimmed. */
  disallowPaths: string[]
}

/** The bag itself, or an empty object to read defaults out of. */
function bag(settings: object): Record<string, unknown> {
  // `object` rather than `Record<string, unknown>`: the two packages declare the
  // settings separately and neither may import the other's, so the row type here
  // is an interface without an index signature. This module is the place that
  // stops trusting that shape anyway.
  const seo = (settings as Record<string, unknown>).seo

  return typeof seo === 'object' && seo !== null ? (seo as Record<string, unknown>) : {}
}

function text(settings: object, key: string): string | undefined {
  const value = bag(settings)[key]

  return typeof value === 'string' && value !== '' ? value : undefined
}

/** The title and description a page without its own falls back to. */
export function seoDefaults(settings: object): {
  title?: string
  description?: string
} {
  const title = text(settings, 'defaultTitle')
  const description = text(settings, 'defaultDescription')

  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),
  }
}

/** The media id a page without a share image of its own falls back to. */
export function seoImageId(settings: object): string | undefined {
  return text(settings, 'defaultOgImageMediaId')
}

/** How the site's name joins a page title, or nothing when it is not set. */
export function seoTitleTemplate(settings: object): string | undefined {
  return text(settings, 'titleTemplate')
}

/**
 * The robots rules the operator added.
 *
 * A missing `robots` object is the ordinary case -- most sites set none of this --
 * and reads as "no extra rules" rather than as an error.
 */
export function robotsRules(settings: object): RobotsRules {
  const robots = bag(settings).robots
  if (typeof robots !== 'object' || robots === null) return { noindex: false, disallowPaths: [] }

  const rules = robots as Record<string, unknown>

  const disallowPaths = Array.isArray(rules.disallowPaths)
    ? rules.disallowPaths
        .filter((path): path is string => typeof path === 'string')
        .map((path) => path.trim())
        .filter((path) => path !== '')
    : []

  return { noindex: rules.noindex === true, disallowPaths }
}
