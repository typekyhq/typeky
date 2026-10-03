import {
  blockToHtml,
  injectAttribution,
  injectRobotsMeta,
  type Block,
  type RenderContext,
} from '@typeky/core'
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
 * What a render needs to know that is not the page's data.
 *
 * `noindex` is here rather than in the context because no template reads it: the
 * platform puts the tag in itself, for the same reason it injects the attribution.
 * A theme is free to print its own -- `injectRobotsMeta` leaves a page that already
 * has one alone -- but it is not what keeps the promise.
 */
export interface RenderOptions {
  noindex?: boolean
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
  options: RenderOptions = {},
): Promise<string> {
  const html = await runtime.renderFile(template, context)

  return injectRobotsMeta(injectAttribution(html, context.site.attribution), options.noindex)
}

/**
 * The same, for a page whose source is its own document.
 *
 * `render` rather than `renderFile`: such a page has no name in the theme, and
 * `{% layout %}` is precisely what it is opting out of. Everything else is the
 * same -- the same engine, the same context, the same attribution floor -- because
 * "a page is a document you can print" is a property of the platform, not of the
 * theme.
 */
export async function renderPageSource(
  runtime: LiquidRuntime,
  source: string,
  context: RenderContext,
  options: RenderOptions = {},
): Promise<string> {
  const html = await runtime.render(source, context)

  return injectRobotsMeta(injectAttribution(html, context.site.attribution), options.noindex)
}
