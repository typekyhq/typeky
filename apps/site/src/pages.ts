/**
 * Platform-owned HTML pages.
 *
 * Plain strings on purpose. The site side renders through LiquidJS only, and
 * Hono's JSX is on the red line for this Worker (architecture section 13, red
 * line 1). These pages cover the window before a theme baseline exists: the
 * placeholder, and the two failure pages. Once the render pipeline lands (M6),
 * `templates/404.liquid` takes over the 404 and this file keeps only the
 * last-resort pages that must not depend on a theme.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character])
}

function page(title: string, body: string): string {
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="robots" content="noindex">',
    `<title>${escapeHtml(title)}</title>`,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

/** Shown for any path until the Liquid render pipeline is wired up (M6). */
export function placeholderPage(path: string): string {
  return page(
    'Typeky is running',
    [
      '<main>',
      '<h1>Typeky is running</h1>',
      '<p>This deployment is not rendering site pages yet.</p>',
      `<p>Requested: <code>${escapeHtml(path)}</code></p>`,
      '</main>',
    ].join('\n'),
  )
}

export function notFoundPage(path: string): string {
  return page(
    'Page not found',
    [
      '<main>',
      '<h1>Page not found</h1>',
      `<p>Nothing is published at <code>${escapeHtml(path)}</code>.</p>`,
      '</main>',
    ].join('\n'),
  )
}

export function errorPage(): string {
  return page(
    'Something went wrong',
    [
      '<main>',
      '<h1>Something went wrong</h1>',
      '<p>This request could not be completed. It has been logged.</p>',
      '</main>',
    ].join('\n'),
  )
}
