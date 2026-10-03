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
  'block',
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
export const LIQUID_PLATFORM_FILTERS = ['asset_url', 'url', 'money', 't', 'render_blocks', 'json_ld'] as const

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
  /** Asset name to content hash, so `asset_url` can version what it links. */
  assetVersions?: Record<string, string>
  /** Absolute prefix for site paths. Empty leaves links relative. */
  baseUrl?: string
  /** Defaults to `USD`. */
  currency?: string
  /**
   * Names in dates, and the language `t` reads.
   *
   * Defaults to `en-US`, and it is pinned rather than left to the runtime: liquidjs
   * falls back to the default locale of whatever is running the engine, so a month
   * name would be the developer's own language in development and English on the
   * edge -- the same page, rendered two ways.
   */
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
  render(source: string, data?: object): Promise<string>
  /**
   * Renders a template by name, honouring the `{% layout %}` it declares.
   *
   * The counterpart to `render` for callers that have a filesystem: a template
   * that names its layout has to be rendered *as the layout's target*, which
   * `render` cannot do because it is for source strings.
   */
  renderFile(name: string, data?: object): Promise<string>
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
    // The same locale the platform filters get below, and pinned for the same
    // reason: liquidjs's own `date` filter falls back to the *runtime's* default
    // locale when it is not given one. That is `zh-CN` on a developer's machine and
    // `en-US` on the edge, so a month name would change when the page is deployed
    // -- and the admin's preview, which formats with `@typeky/core`, would disagree
    // with the site it claims to show.
    locale: options.locale ?? 'en-US',
    parseLimit: limits.parseLimit,
    renderLimit: limits.renderLimit,
    memoryLimit: limits.memoryLimit,
    ...(options.fs === undefined ? {} : { fs: options.fs }),
  })

  restrictRegistry(engine.tags, LIQUID_TAGS)
  restrictRegistry(engine.filters, LIQUID_NATIVE_FILTERS)

  const platformFilters = createPlatformFilters({
    assetBasePath: options.assetBasePath ?? '/theme/',
    ...(options.assetVersions === undefined ? {} : { assetVersions: options.assetVersions }),
    baseUrl: options.baseUrl,
    currency: options.currency ?? 'USD',
    locale: options.locale ?? 'en-US',
    translations: options.translations ?? {},
    renderBlocks: options.renderBlocks,
  })

  for (const [name, filter] of Object.entries(platformFilters)) {
    engine.filters[name] = filter
  }

  const encoder = new TextEncoder()

  /**
   * The context, with anything callable removed.
   *
   * The contract says the context is plain JSON. This enforces it rather than
   * trusting it, because liquidjs *calls* a function it finds in the data -- so a
   * caller who passed one would be handing a theme the ability to run platform
   * code. The architecture's own sketch is the reason to bother: it shows
   * `utils.url` and `i18n.t` as functions, and somebody implementing it from that
   * sketch would be doing exactly this.
   *
   * Microseconds for a page's worth of data. `cached` is per call, so a tree
   * shared between two items is walked once and a cycle is not a hang.
   */
  function plainData(value: unknown, cached = new WeakMap<object, unknown>()): object | undefined {
    if (value === null || typeof value !== 'object') {
      // A function, a string, a number: the first is dropped, the rest are data.
      return typeof value === 'function' ? undefined : (value as object)
    }

    const existing = cached.get(value)
    // Everything this map stores is an array or a plain object, both of which
    // are what it returns.
    if (existing !== undefined) return existing as object

    if (Array.isArray(value)) {
      const list: unknown[] = []
      cached.set(value, list)
      for (const entry of value) list.push(plainData(entry, cached))
      return list
    }

    const copy: Record<string, unknown> = {}
    cached.set(value, copy)
    for (const [key, entry] of Object.entries(value)) {
      const cleaned = plainData(entry, cached)
      if (cleaned !== undefined) copy[key] = cleaned
    }

    return copy
  }

  /**
   * The output-size check, applied to every way out of the engine.
   *
   * Checked after the fact. liquidjs exposes no incremental render hook through
   * its public API, so this aborts the response rather than stopping the
   * allocation; `memoryLimit` and the Workers limit are what bound the allocation
   * itself (section 3.6).
   */
  function guard(html: string): string {
    const bytes = encoder.encode(html).length
    if (bytes > limits.maxOutputBytes) {
      throw new TemplateOutputLimitError(bytes, limits.maxOutputBytes)
    }

    return html
  }

  return {
    engine,
    limits,

    async render(source, data = {}) {
      return guard(await engine.parseAndRender(source, plainData(data)))
    },

    async renderFile(name, data = {}) {
      return guard(await engine.renderFile(name, plainData(data)))
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
