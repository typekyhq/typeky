import { blockToHtml, injectAttribution, type Block, type RenderContext } from '@typeky/core'
import type { LiquidRuntime, LiquidRuntimeOptions } from '@typeky/theme-kit'
import { ASSET_VERSIONS } from '@typeky/theme-default'

/**
 * What every render of the site's theme shares, in one place.
 *
 * There are three callers -- the site's render, the admin's preview, and the test
 * that asserts the first two agree byte for byte -- and the thing that test is
 * for is exactly this: two of them drifting apart. It caught the drift once
 * already, when the stylesheet URL gained a content hash in one path and not the
 * other, and a preview whose stylesheet URL differs from the site's is a preview
 * of a different page.
 *
 * `cache` is deliberately not here. It is the one option the callers must differ
 * on: the site keys the parse cache by the loader's revision so a save is picked
 * up, and a preview must not use a cache at all, because each preview is a
 * different source under the same name.
 */
export function themeRuntimeOptions(
  fs: LiquidRuntimeOptions['fs'],
): Pick<LiquidRuntimeOptions, 'fs' | 'assetVersions' | 'renderBlocks'> {
  return {
    fs,
    // Passed so `asset_url` can version what it links. Without it the URL of a
    // stylesheet never changes, and a deploy that fixes a layout is invisible to
    // anyone who already has the old one.
    assetVersions: ASSET_VERSIONS,
    renderBlocks: (blocks) => (Array.isArray(blocks) ? blockToHtml(blocks as Block[]) : ''),
  }
}

/**
 * Renders a template into the document that actually goes out.
 *
 * The second half of the same story as `themeRuntimeOptions`, and the same lesson
 * learned twice: the preview once passed the asset versions and the site did not,
 * and then the preview injected the attribution and the site's own test path did
 * not. Both are cases of "one render" being written down in two places.
 *
 * The attribution goes in here rather than in the theme because a deployment can
 * edit its templates, and the footer is the first thing anybody edits.
 */
export async function renderDocument(
  runtime: LiquidRuntime,
  template: string,
  context: RenderContext,
): Promise<string> {
  const html = await runtime.renderFile(template, context)

  return injectAttribution(html, context.site.attribution)
}
