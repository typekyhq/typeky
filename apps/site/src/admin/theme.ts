import {
  themeTemplateWriteSchema,
  type ThemePreviewResponse,
  type ThemeTemplateGroup,
  type ThemeTemplateListResponse,
  type ThemeTemplateResponse,
} from '@typeky/api'
import { defaultContext, type ThemeTemplate } from '@typeky/db'
import { createD1DbPort, type DbPort } from '@typeky/platform'
import { createLiquidRuntime } from '@typeky/theme-kit'
import { BASELINE, BASELINE_NAMES } from '@typeky/theme-default'
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
  if (theme !== BUNDLED_THEME) {
    return apiError(c, 'not_found', `no theme is bundled under the name "${theme}"`)
  }

  const overrides = new Map(
    (await store.themeTemplates.list(defaultContext(), theme)).map((row) => [row.path, row]),
  )

  const body: ThemeTemplateListResponse = {
    theme,
    items: BASELINE_NAMES.map((path) => {
      const override = overrides.get(path)

      return {
        path,
        group: groupOf(path),
        overridden: override !== undefined,
        bytes: (override?.source ?? BASELINE[path] ?? '').length,
        updatedAt: override?.updatedAt.toISOString() ?? null,
      }
    }),
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
  if (path === undefined || !Object.hasOwn(BASELINE, path)) {
    return apiError(c, 'not_found', 'the theme does not ship a template by that name')
  }

  const override = await store.themeTemplates.byPath(defaultContext(), theme, path)

  const body: ThemeTemplateResponse = {
    path,
    source: override?.source ?? BASELINE[path] ?? '',
    overridden: override !== null,
    updatedAt: override?.updatedAt.toISOString() ?? null,
  }

  return c.json(body)
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

  if (!Object.hasOwn(BASELINE, path)) {
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

  if (!Object.hasOwn(BASELINE, path)) {
    return apiError(c, 'not_found', 'the theme does not ship a template by that name')
  }

  const problem = validator.validate(source)
  if (problem !== null) {
    return apiError(c, 'invalid_request', problem.message, problem.line ?? undefined)
  }

  try {
    // The stored overrides are read, so the preview shows the site as it is with
    // just this one file replaced -- which is what the editor is showing.
    const html = await renderPreview({ path, source, db: dbFor(c.env) })

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
