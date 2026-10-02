import {
  type ThemeTemplateGroup,
  type ThemeTemplateListResponse,
  type ThemeTemplateResponse,
} from '@typeky/api'
import { defaultContext } from '@typeky/db'
import { BASELINE, BASELINE_NAMES } from '@typeky/theme-default'
import type { Context } from 'hono'
import { apiError, type AdminEnv, type RepositoryResolver } from './errors'

/**
 * The theme's templates.
 *
 * Reads only. Saving is the editor's slice and restoring the baseline is the one
 * after it, but both are built on the same rule: the baseline is the complete
 * set of names, and neither the list nor the read will answer for anything else.
 *
 * There is deliberately no endpoint that creates a template. A site may edit
 * what its theme ships and nothing more -- that is what keeps a theme upgrade
 * from conflicting with files a user added, and it is why the whitelist check
 * needs no database read at all.
 */

/** The theme that ships in this build. */
const BUNDLED_THEME = 'default'

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

/** The theme the site is set to, defaulting to the bundled one. */
async function currentTheme(store: Awaited<ReturnType<RepositoryResolver>>): Promise<string> {
  if (store === null) return BUNDLED_THEME

  const site = await store.sites.get(defaultContext())
  return site?.theme ?? BUNDLED_THEME
}

function groupOf(path: string): ThemeTemplateGroup {
  return path.startsWith('layouts/') ? 'layouts' : path.startsWith('snippets/') ? 'snippets' : 'templates'
}
