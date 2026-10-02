/**
 * @typeky/theme-kit -- Liquid runtime, sandbox limits and theme filters
 *
 * Layout and responsibilities: CONTRIBUTING.md section 6
 * Architecture red lines: CONTRIBUTING.md section 3
 *
 * The two-level template loader (site override, then bundled baseline) lands in
 * M1-S5 and will be exported from here as well.
 */

export { createPlatformFilters, type FilterHandler, type PlatformFilterOptions } from './filters'
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
