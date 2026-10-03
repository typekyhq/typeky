/**
 * The one thing the platform puts in a page's head for a site that is not ready
 * to be found.
 *
 * Injected rather than printed by the theme, for the same reason the attribution
 * is: a deployment can edit its templates, and "do not index this" is a promise
 * the platform makes rather than one an operator's markup keeps. A theme that
 * prints it is fine; a theme that stopped printing it while the setting still said
 * so would be a site that quietly became discoverable.
 */

const ROBOTS_META = '<meta name="robots" content="noindex, nofollow">'

/**
 * Puts the noindex meta in a rendered page, unless it is already there.
 *
 * The check is for any `name="robots"` rather than for this exact tag: a theme
 * with its own opinion about indexing is left to have it, and two tags would be
 * the platform arguing with the page it is rendering.
 *
 * The insert is a string operation rather than a parse, which is what the
 * attribution does too and for the same reason -- this runs on every page, and a
 * parser here would be a second HTML implementation to keep honest.
 */
export function injectRobotsMeta(html: string, noindex: boolean | undefined): string {
  if (noindex !== true) return html
  if (/name\s*=\s*["']robots["']/i.test(html)) return html

  const closing = html.toLowerCase().lastIndexOf('</head>')
  // No head to put it in: at the end is still inside the document, and a crawler
  // reads the whole thing. Better there than nowhere, since the setting is a
  // request not to be indexed.
  if (closing === -1) return html + ROBOTS_META

  return html.slice(0, closing) + ROBOTS_META + html.slice(closing)
}
