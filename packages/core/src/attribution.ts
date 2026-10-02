/**
 * The attribution, and the one thing that removes it.
 *
 * A free deployment says where it came from. A white-label licence is the way to
 * stop saying it, and it is a one-off purchase rather than a subscription --
 * which is why the decision here is a boolean and not a date.
 *
 * The link is deliberately `rel="noopener"` and deliberately *not* `nofollow`.
 * `noopener` is a safety property of any link that can open a window; `nofollow`
 * would tell a search engine to ignore the backlink, and the backlink is the part
 * of the attribution that has value to the platform. A link that the page tells
 * crawlers to disregard would be a badge pretending to be one.
 */

import { escapeHtml } from './html'

/** Where a hosted site's attribution points. */
export const TYPEKY_URL = 'https://typeky.com'

export interface Attribution {
  text: string
  url: string
}

export const ATTRIBUTION: Attribution = {
  text: 'Powered by Typeky',
  url: TYPEKY_URL,
}

/**
 * What the site should show, or nothing.
 *
 * Returning `undefined` rather than an empty object keeps the template's `{% if %}`
 * honest: there is either a badge to render or there is not, and a theme author
 * cannot half-render one by reading a field that happens to be blank.
 */
export function attributionFor(options: { whiteLabel: boolean }): Attribution | undefined {
  return options.whiteLabel ? undefined : ATTRIBUTION
}

/**
 * The attribute that says "the attribution is already here".
 *
 * The theme writes it, and the fallback below looks for it. An attribute rather
 * than a search for the URL: a theme is allowed to word the badge its own way, and
 * a text match would either miss that or fire on a mention in a post.
 */
export const ATTRIBUTION_MARKER = 'data-typeky-attribution'

/**
 * Puts the attribution in a rendered page if the theme did not.
 *
 * The theme rendering it is the design; this is the floor under it. A deployment
 * can edit its templates, and the footer is the first thing anybody edits, so
 * "the badge is rendered" cannot be a property that only the theme's cooperation
 * provides. When the theme has done it, this does nothing at all and the markup is
 * entirely the theme's; when it has not, the page gets one anchor and the rest of
 * the theme's choices are left alone.
 *
 * Inserted before the closing `</body>` so it lands where a footer belongs, and
 * appended when there is no such tag -- a template that renders a fragment rather
 * than a document should end up with the badge somewhere rather than with a 500.
 */
export function injectAttribution(html: string, attribution: Attribution | undefined): string {
  if (attribution === undefined) return html
  if (html.includes(ATTRIBUTION_MARKER)) return html

  const element =
    `<p class="attribution">` +
    `<a href="${escapeHtml(attribution.url)}" rel="noopener" ${ATTRIBUTION_MARKER}>` +
    `${escapeHtml(attribution.text)}</a></p>`

  const closing = html.toLowerCase().lastIndexOf('</body>')
  if (closing === -1) return html + element

  return html.slice(0, closing) + element + html.slice(closing)
}
