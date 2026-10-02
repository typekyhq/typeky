/**
 * @typeky/theme-kit -- Liquid runtime, sandbox limits, theme filters and the
 * two-level template loader
 *
 * Layout and responsibilities: CONTRIBUTING.md section 6
 * Architecture red lines: CONTRIBUTING.md section 3
 *
 * Typical wiring, as the site Worker does it:
 *
 *   const loader = createTemplateLoader({ db, theme: site.theme, baseline })
 *   const runtime = createLiquidRuntime({
 *     fs: loader.fs,
 *     cache: createRevisionCache({ revision: () => loader.revision }),
 *   })
 *
 * Saving a template bumps the loader's revision, which clears the parse cache on
 * the next render.
 */

export { createPlatformFilters, type FilterHandler, type PlatformFilterOptions } from './filters'

export {
  createRevisionCache,
  DEFAULT_MAX_CACHED_TEMPLATES,
  type ParsedTemplateCache,
  type RevisionCacheOptions,
} from './cache'

export {
  createTemplateLoader,
  DEFAULT_MAX_OVERRIDES,
  DEFAULT_MAX_OVERRIDE_BYTES,
  type TemplateLoader,
  type TemplateLoaderOptions,
} from './loader'

export {
  createLiquidRuntime,
  DEFAULT_RENDER_LIMITS,
  LIQUID_FILTERS,
  LIQUID_NATIVE_FILTERS,
  LIQUID_PLATFORM_FILTERS,
  LIQUID_TAGS,
  TemplateOutputLimitError,
  type LiquidRuntime,
  type LiquidRuntimeOptions,
  type RenderLimits,
} from './runtime'
