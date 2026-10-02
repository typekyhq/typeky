import { Liquid } from 'liquidjs'
import type { FS } from 'liquidjs'
import type { ParsedTemplateCache } from './cache'
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
  /** Template filesystem. Without one, `{% render %}` and `{% layout %}` cannot resolve a name. */
  fs?: FS
  /** Parsed-template cache. Pass `createRevisionCache` so saving a template clears it. */
  cache?: boolean | ParsedTemplateCache
}

/**
 * A template that will not parse.
 *
 * `line` is 1-based when the parser could say where it gave up, and null when it
 * could not -- a problem the admin can point at is worth more than one it can
 * only describe, but claiming a line that is wrong is worse than admitting to
 * none.
 */
export interface TemplateProblem {
  message: string
  line: number | null
}

export interface LiquidRuntime {
  /** The locked-down engine, for callers that resolve templates by name. */
  readonly engine: Liquid
  readonly limits: RenderLimits
  render(source: string, data?: Record<string, unknown>): Promise<string>
  /**
   * Parses without rendering.
   *
   * The same engine, so the same answer: a tag or filter this build does not
   * allow fails here exactly as it would at render time, which is the point of
   * checking before a save rather than after a page breaks. Nothing is
   * evaluated -- no data is passed in, and no host function runs.
   */
  validate(source: string): TemplateProblem | null
}

/**
 * The line a parse error points at, from the token's character offset.
 *
 * liquidjs puts `line:N, col:M` in the message text and leaves `token.line`
 * undefined, so reading the number back out of the prose would break the day the
 * wording changes. `begin` is an offset into the source we already have, which
 * is ours to count.
 */
function locate(source: string, error: unknown): number | null {
  const begin = (error as { token?: { begin?: unknown } }).token?.begin
  if (typeof begin !== 'number' || begin < 0 || begin > source.length) return null

  return source.slice(0, begin).split('\n').length
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
    cache: options.cache ?? true,
    // Names are theme-root relative; `./` and `../` are not a supported spelling.
    relativeReference: false,
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
    ...(options.fs === undefined ? {} : { fs: options.fs }),
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

    validate(source) {
      try {
        engine.parse(source)
        return null
      } catch (error) {
        return {
          message: error instanceof Error ? error.message : String(error),
          line: locate(source, error),
        }
      }
    },
  }
}
