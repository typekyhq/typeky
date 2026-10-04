import {
  themeContextResponseSchema,
  themeTemplateWriteSchema,
  themeUploadSchema,
  type ThemeListResponse,
  type ThemeSummary as ThemeSummaryResponse,
  type ThemeContextResponse,
  type ThemePreviewResponse,
  type ThemeTemplateGroup,
  type ThemeTemplateListResponse,
  type ThemeTemplateResponse,
} from '@typeky/api'
import { defaultContext, type ThemeTemplate } from '@typeky/db'
import { createD1DbPort, type DbPort } from '@typeky/platform'
import { LIQUID_NATIVE_FILTERS, LIQUID_PLATFORM_FILTERS, LIQUID_TAGS, createLiquidRuntime } from '@typeky/theme-kit'
import {
  isUploadableThemePath,
  listThemes,
  themeAssetVersions,
  themeBaseline,
  themeExists,
  themeFileOriginal,
  themeTemplates,
} from '../themes'
import { contextPaths } from '../render/sample'
import type { Context } from 'hono'
import { apiError, describeIssues, readJsonBody, type AdminEnv, type RepositoryResolver } from './errors'
import { renderPreview } from '../render/preview'

/** The D1 port, when there is one. The preview reads other overrides through it. */
function dbFor(env: AdminEnv['Bindings']): DbPort | undefined {
  if (env.DB === undefined) return undefined

  return createD1DbPort(env.DB)
}

/**
 * The theme's templates.
 *
 * The baseline is the complete set of names, and neither the list, the read nor
 * the write will answer for anything else. That is what makes the whitelist a
 * memory lookup rather than a prefix test.
 *
 * There is deliberately no endpoint that creates a template. A site may edit
 * what its theme ships and nothing more -- that is what keeps a theme upgrade
 * from conflicting with files a user added.
 */

/** The theme that ships in this build. */
const BUNDLED_THEME = 'default'

/**
 * One engine for validating what is about to be saved.
 *
 * Module scope because parsing needs no filesystem and no data, and building a
 * liquidjs engine per request would be work for nothing. `cache: false` because
 * a validating engine never renders the same source twice.
 */
const validator = createLiquidRuntime({ cache: false })

export async function readThemeTemplates(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const theme = await currentTheme(store)

  // The editor edits whichever theme the site is serving, so the only thing that
  // cannot be listed is a theme that is not installed -- which is what this 404
  // means, and what a settings screen that accepted a typo gets told.
  if (!(await themeExists(store, theme))) {
    return apiError(c, 'not_found', `no theme is installed under the name "${theme}"`)
  }

  const files = await themeTemplates(store, theme)

  const body: ThemeTemplateListResponse = {
    theme,
    items: files.map((file) => ({
      path: file.path,
      group: groupOf(file.path),
      overridden: file.edited,
      bytes: file.source.length,
      updatedAt: file.updatedAt?.toISOString() ?? null,
    })),
  }

  return c.json(body)
}

/**
 * The paths a template may read, from the sample context the previews render with.
 *
 * Derived, not written down: a hand-kept list of what a template can use stops
 * being true the first time the context gains a field, and the way it goes wrong is
 * by telling an author about something that renders nothing. The derivation lives
 * in `render/sample.ts`, beside the sample itself.
 */
export async function readThemeContext(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  // A query parameter, like the template read, and for the same reason: a template
  // name contains a slash.
  const template = c.req.query('template')
  const known =
    template === undefined ? null : await themeFileOriginal(store, await currentTheme(store), template)

  if (template === undefined || known === null) {
    return apiError(c, 'not_found', 'the theme does not ship a template by that name')
  }

  const body: ThemeContextResponse = {
    template,
    paths: contextPaths(template),
    // From the sandbox's own whitelists rather than a list kept beside them: what a
    // template may use is exactly what the engine was built with, and the reason to
    // show it at all is that anything else fails loudly.
    tags: [...LIQUID_TAGS],
    platformFilters: [...LIQUID_PLATFORM_FILTERS],
    nativeFilters: [...LIQUID_NATIVE_FILTERS],
  }

  return c.json(body)
}

export async function readThemeTemplate(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const theme = await currentTheme(store)

  // A query parameter rather than a path segment: a template name contains a
  // slash, and encoding one into a path is how path-traversal bugs start.
  const path = c.req.query('path')
  const file =
    path === undefined ? undefined : (await themeTemplates(store, theme)).find((entry) => entry.path === path)

  if (path === undefined || file === undefined) {
    return apiError(c, 'not_found', 'the theme does not ship a template by that name')
  }

  const body: ThemeTemplateResponse = {
    path,
    source: file.source,
    overridden: file.edited,
    updatedAt: file.updatedAt?.toISOString() ?? null,
  }

  return c.json(body)
}

/**
 * Drops an override, putting the bundled template back.
 *
 * The name is checked against the baseline first, as everywhere else. Deleting a
 * row that is not there answers 404 rather than pretending: "restored" when
 * nothing was overridden would be a lie the operator cannot see through.
 */
export async function resetThemeTemplate(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const theme = await currentTheme(store)
  const path = c.req.query('path')

  if (path === undefined || (await themeFileOriginal(store, theme, path)) === null) {
    return apiError(c, 'not_found', 'the theme does not ship a template by that name')
  }

  const dropped = await store.themeTemplates.restore(defaultContext(), theme, path)
  if (!dropped) return apiError(c, 'not_found', 'that template has no override to restore')

  return c.body(null, 204)
}

/* ---------------------------------------------------------------- themes -- */

/** Every theme the deployment can serve, and the one the site is using. */
export async function readThemes(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  return c.json(await themeListBody(store))
}

/**
 * Adds a theme.
 *
 * Everything is checked before anything is written, and in the order that makes a
 * failure cheap: the files are a shape, the paths are ones a theme may hold, and the
 * source parses -- because a theme that half-works fails on a page rather than at the
 * door, and the operator would have no idea which file did it.
 */
export async function uploadTheme(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = themeUploadSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', describeIssues(parsed.error.issues))

  const { name, files } = parsed.data
  if (await themeExists(store, name)) {
    return apiError(c, 'name_taken', `a theme called "${name}" already exists`)
  }

  // No completeness check: a theme is layered over the bundled one, so a file it does
  // not ship is a file it did not change rather than a page that cannot render.
  for (const file of files) {
    if (!isUploadableThemePath(file.path)) {
      return apiError(c, 'invalid_request', `"${file.path}" is not a path a theme may hold`)
    }

    if (!file.path.startsWith('assets/')) {
      const problem = validator.validate(file.source)
      if (problem !== null) {
        return apiError(
          c,
          'invalid_request',
          `${file.path}: ${problem.message}`,
          problem.line ?? undefined,
        )
      }
    }
  }

  for (const file of files) {
    await store.themeTemplates.save(defaultContext(), {
      theme: name,
      path: file.path,
      source: file.source,
      // Recorded once, at the upload: it is what "restore" puts back, and an edit
      // must not overwrite it.
      originalSource: file.source,
    })
  }

  return c.json(await themeListBody(store), 201)
}

/** Removes an uploaded theme. The bundled one has no rows, so it cannot be removed. */
export async function deleteTheme(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const name = c.req.query('name')
  if (name === undefined || name === BUNDLED_THEME) {
    return apiError(c, 'invalid_request', 'the bundled theme cannot be removed')
  }

  if ((await store.themeTemplates.removeTheme(defaultContext(), name)) === 0) {
    return apiError(c, 'not_found', 'no theme by that name')
  }

  return c.body(null, 204)
}

async function themeListBody(
  store: NonNullable<ReturnType<RepositoryResolver>>,
): Promise<ThemeListResponse> {
  const themes: ThemeSummaryResponse[] = (await listThemes(store)).map((entry) => ({
    name: entry.name,
    files: entry.files,
    updatedAt: entry.updatedAt?.toISOString() ?? null,
    bundled: entry.bundled,
  }))

  return { themes, active: await currentTheme(store) }
}

/* -------------------------------------------------------------- helpers -- */

/**
 * Saves an override, refusing anything that would break the site.
 *
 * Three checks in order of how cheap they are. The name is checked against the
 * baseline before anything is read or written, because a name the theme does not
 * ship is not a thing that can be stored. Then the source is parsed -- a
 * template that will not parse is one that 500s the moment its page is asked
 * for, and finding that out now, with a line, is the whole point. Only then does
 * it reach the database.
 */
export async function writeThemeTemplate(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const theme = await currentTheme(store)

  const parsed = themeTemplateWriteSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', describeIssues(parsed.error.issues))

  const { path, source } = parsed.data

  if ((await themeFileOriginal(store, theme, path)) === null) {
    return apiError(c, 'not_found', 'the theme does not ship a template by that name')
  }

  const problem = validator.validate(source)
  if (problem !== null) {
    return apiError(c, 'invalid_request', problem.message, problem.line ?? undefined)
  }

  const saved = await store.themeTemplates.save(defaultContext(), { theme, path, source })

  return c.json(toResponse(saved))
}

/** The theme the site is set to, defaulting to the bundled one. */
async function currentTheme(store: Awaited<ReturnType<RepositoryResolver>>): Promise<string> {
  if (store === null) return BUNDLED_THEME

  const site = await store.sites.get(defaultContext())
  return site?.theme ?? BUNDLED_THEME
}

/**
 * Renders an unsaved template with sample data.
 *
 * The same three checks as a save, in the same order, because a preview that
 * accepted something a save would refuse is a preview that lies. It then renders
 * through the theme's own loader with the draft layered in, so what comes back is
 * what the site would produce -- not a fragment rendered beside it.
 *
 * Nothing is written and nothing is cached. A render failure is the author's
 * typing rather than the server's problem, so it answers 400 with the message,
 * the same way a parse failure does: from the outside those are one event.
 */
export async function previewThemeTemplate(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = themeTemplateWriteSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', describeIssues(parsed.error.issues))

  const { path, source } = parsed.data

  const theme = await currentTheme(store)

  if ((await themeFileOriginal(store, theme, path)) === null) {
    return apiError(c, 'not_found', 'the theme does not ship a template by that name')
  }

  const problem = validator.validate(source)
  if (problem !== null) {
    return apiError(c, 'invalid_request', problem.message, problem.line ?? undefined)
  }

  try {
    // The stored overrides are read, so the preview shows the site as it is with
    // just this one file replaced -- which is what the editor is showing.
    const html = await renderPreview({
      path,
      source,
      db: dbFor(c.env),
      baseline: await themeBaseline(store, theme),
      assetVersions: await themeAssetVersions(store, theme),
    })

    const body: ThemePreviewResponse = { html, bytes: new TextEncoder().encode(html).length }
    return c.json(body)
  } catch (error) {
    return apiError(
      c,
      'invalid_request',
      `the template failed to render: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function groupOf(path: string): ThemeTemplateGroup {
  return path.startsWith('layouts/') ? 'layouts' : path.startsWith('snippets/') ? 'snippets' : 'templates'
}

function toResponse(template: ThemeTemplate): ThemeTemplateResponse {
  return {
    path: template.path,
    source: template.source,
    overridden: true,
    updatedAt: template.updatedAt.toISOString(),
  }
}
