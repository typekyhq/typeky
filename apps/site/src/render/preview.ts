import { createLiquidRuntime, createTemplateLoader } from '@typeky/theme-kit'
import { BASELINE } from '@typeky/theme-default'
import type { DbPort } from '@typeky/platform'
import { sampleContext } from './sample'
import { renderDocument, themeRuntimeOptions } from './theme-runtime'

/**
 * Rendering a template with sample data, storing nothing.
 *
 * The mechanism is the theme's own two-level loader with the draft injected: the
 * edited source is layered over the theme exactly as a saved override would be,
 * so `{% render 'header' %}` resolves to the theme's header and `{% layout %}`
 * to its layout. A preview built any other way would be answering a different
 * question than the one the site will answer, and "what you see is what you get"
 * would be a claim about two code paths agreeing.
 *
 * The stored overrides are still read, because the honest picture of a page
 * includes the other templates somebody has already changed; only this one is
 * replaced by the draft.
 *
 * Nothing is written, and nothing is cached: the draft is not a revision of
 * anything, and a preview that warmed the render cache would be a way to publish
 * by accident.
 */

/**
 * A database that has no overrides.
 *
 * The preview endpoint has one already; this exists so a caller can render with
 * only the baseline and a draft, which is what the tests want and what a
 * self-contained render needs.
 */
const NO_OVERRIDES: DbPort = {
  async all() {
    return []
  },
  async first() {
    return null
  },
  async run() {
    return 0
  },
  async batch() {
    return undefined
  },
}

export interface PreviewInput {
  /** Normalised template name, e.g. `templates/post`. */
  path: string
  /** The unsaved source to render. */
  source: string
  /** The store to read the other overrides from, if there is one. */
  db?: DbPort
  /** The theme being edited. Defaults to the bundled one. */
  theme?: string
  /**
   * The theme's own files.
   *
   * Handed in rather than imported: an uploaded theme's files live in the database,
   * and the preview has to render the same set the site would -- a preview of a
   * different baseline is a preview of a different page.
   */
  baseline?: Record<string, string> | null
  assetVersions?: Record<string, string>
}

export async function renderPreview(input: PreviewInput): Promise<string> {
  const loader = createTemplateLoader({
    db: input.db ?? NO_OVERRIDES,
    theme: input.theme ?? 'default',
    baseline: input.baseline ?? BASELINE,
    draft: { path: input.path, source: input.source },
  })

  const runtime = createLiquidRuntime({
    ...themeRuntimeOptions(loader.fs, input.assetVersions),
    // No cache: each preview is a different source under the same name, and a
    // cached one would show the previous preview's output.
    cache: false,
  })

    // `renderDocument` rather than the engine directly: the engine call would skip
  // the runtime's output limits and its stripping of anything callable from the
  // context, so the preview would be rendered by a more permissive path than the
  // site it claims to reproduce.
  return renderDocument(runtime, input.path, sampleContext(input.path))
  }
