import type { FilterImplOptions } from 'liquidjs'

/**
 * Platform filters templates may call (architecture section 3.6).
 *
 * `money` and `t` come from the documented whitelist. `render_blocks` is the only
 * outlet for rendered content (section 3.11); its implementation is injected
 * rather than imported, because `blockToHtml()` arrives with the block editor.
 */

/**
 * Handler shape: the piped value first, filter arguments after.
 *
 * liquidjs does not export its own handler type -- `FilterImpl` is the `this`
 * binding, not the function -- so this mirrors it. Nothing here uses `this`.
 */
export type FilterHandler = (value: unknown, ...args: unknown[]) => unknown

/** A filter whose output must not be escaped again by `outputEscape`. */
export interface RawFilter {
  handler: FilterHandler
  raw: true
}

export interface PlatformFilterOptions {
  /** Asset path prefix. Normalised to start and end with a slash. */
  assetBasePath: string
  /**
   * Absolute prefix for site paths, for example `https://example.com`.
   *
   * Empty leaves them relative, which is what a preview wants: the preview runs
   * on the admin's origin and must not hand out links to the attacker's
   * `https://` if the site has not been configured yet.
   */
  baseUrl?: string
  /** ISO 4217 code for `money`. */
  currency: string
  /** Locale used to format `money`. Pinned so output is deterministic. */
  locale: string
  /** Key to text for `t`. A missing key renders as the key. */
  translations: Record<string, string>
  /** Blocks to sanitised HTML. Absent until the block editor lands (M3). */
  renderBlocks?: (blocks: unknown) => string
}

function normalizeBasePath(basePath: string): string {
  const withLeading = basePath.startsWith('/') ? basePath : `/${basePath}`
  return withLeading.endsWith('/') ? withLeading : `${withLeading}/`
}

export function createPlatformFilters(
  options: PlatformFilterOptions,
): Record<string, FilterImplOptions> {
  const assetBasePath = normalizeBasePath(options.assetBasePath)

  // Built once: constructing a formatter per call is the expensive part.
  const formatter = new Intl.NumberFormat(options.locale, {
    style: 'currency',
    currency: options.currency,
  })

  // Themes write asset paths the Shopify way, with or without a leading slash.
  const assetUrl: FilterHandler = (value) =>
    `${assetBasePath}${String(value ?? '').replace(/^\/+/, '')}`

  const money: FilterHandler = (value) => {
    const cents = Number(value)
    if (!Number.isFinite(cents)) return ''
    return formatter.format(cents / 100)
  }

  // A missing key falls back to the key itself, so it shows up on the page
  // instead of silently rendering nothing.
  const translate: FilterHandler = (value) => {
    const key = String(value ?? '')
    return options.translations[key] ?? key
  }

  const renderBlocks: RawFilter = {
    raw: true,
    handler: (value) => {
      if (options.renderBlocks === undefined) {
        throw new Error(
          'render_blocks is not wired yet: blockToHtml() arrives with the block editor (M3)',
        )
      }
      return options.renderBlocks(value)
    },
  }

  /**
   * A site path made absolute.
   *
   * The counterpart to `asset_url` for links rather than files, and the reason
   * it exists is that templates need to know the site's own origin: a canonical
   * URL or an Open Graph URL that is relative is not one.
   *
   * Anything already absolute, or not a path at all, is returned untouched --
   * including protocol-relative `//host` and `#anchor`. A link a theme wrote in
   * full is not the platform's to rewrite.
   */
  const siteUrl: FilterHandler = (value) => {
    const path = String(value ?? '')
    if (path === '') return ''
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path) || path.startsWith('//') || path.startsWith('#')) {
      return path
    }

    const base = (options.baseUrl ?? '').replace(/\/+$/, '')
    return `${base}${path.startsWith('/') ? '' : '/'}${path}`
  }

  return { asset_url: assetUrl, url: siteUrl, money, t: translate, render_blocks: renderBlocks }
}
