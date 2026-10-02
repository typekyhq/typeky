import { Liquid } from 'liquidjs'
import { createPlatformFilters } from './filters'

/**
 * The Liquid runtime: one factory that locks the engine down to the whitelist and
 * limits in architecture section 3.6, and the only way templates get rendered.
 *
 * Every limit is set explicitly. liquidjs defaults are not relied on, because its
 * limits are cooperative rather than a sandbox -- the real backstop is the
 * Workers process limit -- and a default that changes upstream would silently
 * widen the budget here.
 */

export interface RenderLimits {
  /** Template source length, in characters. */
  parseLimit: number
  /** Wall-clock budget for one render, in milliseconds. */
  renderLimit: number
  /** Cooperative allocation budget, in bytes. */
  memoryLimit: number
  /** Rendered output size, in bytes. */
  maxOutputBytes: number
}

export const DEFAULT_RENDER_LIMITS: RenderLimits = {
  parseLimit: 2_000_000,
  renderLimit: 500,
  memoryLimit: 8_000_000,
  maxOutputBytes: 5_000_000,
}

/**
 * Tags a template may use (architecture section 3.6).
 *
 * liquidjs ships three more -- `block`, `echo` and `tablerow` -- which nothing in
 * the theme contract uses. An unused tag is only extra surface, so they are
 * dropped. `paginate` is deliberately absent: liquidjs has no such tag, and
 * pagination reaches templates as data (section 3.8).
 */
export const LIQUID_TAGS = [
  'assign',
  'break',
  'capture',
  'case',
  'comment',
  'continue',
  'cycle',
  'decrement',
  'for',
  'if',
  'include',
  'increment',
  'layout',
  'liquid',
  'raw',
  'render',
  'unless',
] as const

/** Filters liquidjs itself provides and the whitelist keeps. */
export const LIQUID_NATIVE_FILTERS = [
  'abs',
  'append',
  'capitalize',
  'ceil',
  'compact',
  'date',
  'default',
  'divided_by',
  'downcase',
  'escape',
  'escape_once',
  'first',
  'floor',
  'join',
  'json',
  'last',
  'map',
  'minus',
  'modulo',
  'newline_to_br',
  'plus',
  'prepend',
  // Kept on purpose. Escaping is on by default and this is the single documented
  // way to emit HTML the platform produced and sanitised itself. It is also the
  // widest remaining hole in the whitelist, which is why themes that use it are
  // audited rather than trusted (section 3.6).
  'raw',
  'replace',
  'replace_first',
  'reverse',
  'round',
  'size',
  'slice',
  'sort',
  'split',
  'strip',
  'strip_html',
  'times',
  'truncate',
  'truncatewords',
  'uniq',
  'upcase',
  'url_decode',
  'url_encode',
  'where',
] as const

/** Filters this platform adds. */
export const LIQUID_PLATFORM_FILTERS = ['asset_url', 'money', 't', 'render_blocks'] as const

/** Everything a template may use. */
export const LIQUID_FILTERS = [...LIQUID_NATIVE_FILTERS, ...LIQUID_PLATFORM_FILTERS] as const

export class TemplateOutputLimitError extends Error {
  constructor(
    readonly bytes: number,
    readonly limit: number,
  ) {
    super(`rendered ${bytes} bytes, over the ${limit} byte output limit`)
    this.name = 'TemplateOutputLimitError'
  }
}

export interface LiquidRuntimeOptions {
  /** Lowered by tests; production uses `DEFAULT_RENDER_LIMITS`. */
  limits?: Partial<RenderLimits>
  /** Defaults to `/theme/`, where theme assets are served from. */
  assetBasePath?: string
  /** Defaults to `USD`. */
  currency?: string
  /** Defaults to `en-US`. */
  locale?: string
  translations?: Record<string, string>
  /** Wired from `@typeky/core` once `blockToHtml()` exists (M3). */
  renderBlocks?: (blocks: unknown) => string
}

export interface LiquidRuntime {
  /** The locked-down engine, for callers that resolve templates by name. */
  readonly engine: Liquid
  readonly limits: RenderLimits
  render(source: string, data?: Record<string, unknown>): Promise<string>
}

/** Deletes every registry entry the whitelist does not name. */
function restrictRegistry(registry: Record<string, unknown>, allowed: readonly string[]): void {
  for (const name of Object.keys(registry)) {
    if (!allowed.includes(name)) delete registry[name]
  }
}

export function createLiquidRuntime(options: LiquidRuntimeOptions = {}): LiquidRuntime {
  const limits: RenderLimits = { ...DEFAULT_RENDER_LIMITS, ...options.limits }

  const engine = new Liquid({
    cache: true,
    // Reads own properties only, so `{{ x.constructor }}` cannot walk the
    // prototype chain.
    ownPropertyOnly: true,
    // A missing variable renders empty rather than failing the page.
    strictVariables: false,
    // A filter the whitelist removed must fail loudly. Left off, liquidjs
    // silently renders nothing, which reads as a theme bug instead of a
    // capability that was deliberately withheld.
    strictFilters: true,
    // liquidjs does not escape output on its own: without this, every
    // `{{ value }}` is an XSS hole. Verified against liquidjs 10.29.
    outputEscape: 'escape',
    parseLimit: limits.parseLimit,
    renderLimit: limits.renderLimit,
    memoryLimit: limits.memoryLimit,
  })

  restrictRegistry(engine.tags, LIQUID_TAGS)
  restrictRegistry(engine.filters, LIQUID_NATIVE_FILTERS)

  const platformFilters = createPlatformFilters({
    assetBasePath: options.assetBasePath ?? '/theme/',
    currency: options.currency ?? 'USD',
    locale: options.locale ?? 'en-US',
    translations: options.translations ?? {},
    renderBlocks: options.renderBlocks,
  })

  for (const [name, filter] of Object.entries(platformFilters)) {
    engine.filters[name] = filter
  }

  const encoder = new TextEncoder()

  return {
    engine,
    limits,

    async render(source, data = {}) {
      const html = await engine.parseAndRender(source, data)
      const bytes = encoder.encode(html).length

      // Checked after the fact. liquidjs exposes no incremental render hook
      // through its public API, so this aborts the response rather than stopping
      // the allocation; `memoryLimit` and the Workers limit are what bound the
      // allocation itself (section 3.6).
      if (bytes > limits.maxOutputBytes) {
        throw new TemplateOutputLimitError(bytes, limits.maxOutputBytes)
      }

      return html
    },
  }
}
