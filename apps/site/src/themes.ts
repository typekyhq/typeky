import { defaultContext, type Repositories } from '@typeky/db'
import { ASSET_VERSIONS, BASELINE, BASELINE_NAMES } from '@typeky/theme-default'

/**
 * The themes a deployment can serve.
 *
 * A theme *is* its files, so the list is derived from the rows in
 * `theme_templates` rather than kept in a table of its own -- and the bundled theme
 * is the one theme with none of them, until somebody edits it.
 *
 * Files are told apart by their path, which is what the bundled theme already
 * writes: `layouts/`, `templates/` and `snippets/` are templates, and `assets/` is
 * everything the browser fetches rather than the renderer.
 */

/** The theme that ships in code. It is not one of the uploaded ones and cannot be replaced. */
export const BUNDLED_THEME = 'default'

/** What a theme's files are for. */
const TEMPLATE_PREFIXES = ['layouts/', 'templates/', 'snippets/'] as const
const ASSET_PREFIX = 'assets/'

export interface ThemeListing {
  name: string
  /** Files in the theme, templates and assets together. */
  files: number
  updatedAt: Date | null
  /** True for the theme that ships in code, which has no rows of its own. */
  bundled: boolean
}

/** Every theme, the bundled one first, then the uploaded ones by name. */
export async function listThemes(store: Repositories): Promise<ThemeListing[]> {
  const rows = await store.themeTemplates.themes(defaultContext())

  const uploaded = rows
    .filter((row) => row.name !== BUNDLED_THEME)
    .map((row) => ({ name: row.name, files: row.files, updatedAt: row.updatedAt, bundled: false }))
    // Sorted here rather than trusting the query's `ORDER BY`: the list is a contract,
    // and a contract that depends on how a statement happened to be written is one
    // that changes when somebody edits the SQL.
    .sort((left, right) => left.name.localeCompare(right.name))

  return [
    { name: BUNDLED_THEME, files: BASELINE_NAMES.length, updatedAt: null, bundled: true },
    ...uploaded,
  ]
}

/** Whether a theme can be served at all. */
export async function themeExists(store: Repositories, theme: string): Promise<boolean> {
  if (theme === BUNDLED_THEME) return true

  return (await listThemes(store)).some((entry) => entry.name === theme)
}

/** One file of a theme, as the editor needs it. */
export interface ThemeFile {
  path: string
  source: string
  /** True when the file differs from what the theme shipped. */
  edited: boolean
  updatedAt: Date | null
}

/**
 * The templates of a theme, ordered by path.
 *
 * The bundled theme's list is its baseline in code, whether or not any of it has
 * been edited; an uploaded theme's is whatever it shipped.
 */
export async function themeTemplates(store: Repositories, theme: string): Promise<ThemeFile[]> {
  const rows = await store.themeTemplates.list(defaultContext(), theme)

  if (theme === BUNDLED_THEME) {
    const byPath = new Map(rows.map((row) => [row.path, row]))

    return [...BASELINE_NAMES].sort().map((path) => {
      const row = byPath.get(path)

      return {
        path,
        source: row?.source ?? (BASELINE[path] as string),
        edited: row !== undefined,
        updatedAt: row?.updatedAt ?? null,
      }
    })
  }

  return rows
    .filter((row) => isTemplatePath(row.path))
    .map((row) => ({
      path: row.path,
      source: row.source,
      // For an uploaded theme a row is the file, so "edited" is the difference
      // between what it says now and what it was uploaded as.
      edited: row.originalSource !== null && row.originalSource !== row.source,
      updatedAt: row.updatedAt,
    }))
}

/** The source a theme shipped a file as, or null when the theme has no such file. */
export async function themeFileOriginal(
  store: Repositories,
  theme: string,
  path: string,
): Promise<string | null> {
  if (theme === BUNDLED_THEME) return (BASELINE[path] as string | undefined) ?? null

  const row = await store.themeTemplates.byPath(defaultContext(), theme, path)
  return row === null ? null : (row.originalSource ?? row.source)
}

/**
 * The whole theme as the template loader wants it: name to source.
 *
 * This is the theme's *original* set -- for the bundled theme, the baseline in
 * code; for an uploaded one, what it shipped. The loader layers the site's edits on
 * top, which is why this must not answer with the edited sources.
 */
export async function themeBaseline(
  store: Repositories,
  theme: string,
): Promise<Record<string, string> | null> {
  if (theme === BUNDLED_THEME) return BASELINE

  if (!(await themeExists(store, theme))) return null

  const rows = await store.themeTemplates.list(defaultContext(), theme)

  return Object.fromEntries(
    rows
      .filter((row) => isTemplatePath(row.path))
      .map((row) => [row.path, row.originalSource ?? row.source]),
  )
}

/**
 * The versions `asset_url` appends, per asset name.
 *
 * The bundled theme has content hashes from its build; an uploaded theme's files
 * have a revision that changes on every save, which is enough for the URL to change
 * when the bytes do -- and needs no hashing at request time.
 */
export async function themeAssetVersions(
  store: Repositories,
  theme: string,
): Promise<Record<string, string>> {
  if (theme === BUNDLED_THEME) return { ...ASSET_VERSIONS }

  const rows = await store.themeTemplates.list(defaultContext(), theme)
  const assets = rows.filter((row) => !isTemplatePath(row.path))

  return Object.fromEntries(
    assets.map((row) => [assetNameOf(row.path), String(row.updatedAt.getTime())]),
  )
}

/** An uploaded theme's asset source, or null when it does not have that file. */
export async function themeAssetSource(
  store: Repositories,
  theme: string,
  name: string,
): Promise<string | null> {
  if (theme === BUNDLED_THEME) return null

  const row = await store.themeTemplates.byPath(defaultContext(), theme, `${ASSET_PREFIX}${name}`)

  return row?.source ?? null
}

/**
 * Whether a path from an uploaded theme is one a theme may hold.
 *
 * Templates live under the three directories the renderer knows, named without an
 * extension, because that is how a theme names them; assets live under `assets/`
 * and keep theirs. A segment climbing out of the theme, an absolute path, a
 * directory nothing reads: all of it is refused rather than stored, because a file
 * that no list can reach is a file nobody can remove either.
 */
export function isUploadableThemePath(path: string): boolean {
  if (path.includes('..') || path.includes('\\') || path.startsWith('/')) return false

  if (path.startsWith(ASSET_PREFIX)) {
    return path.length > ASSET_PREFIX.length && /^[A-Za-z0-9._/-]+$/.test(path)
  }

  return /^(?:layouts|templates|snippets)\/[a-z0-9_/-]+$/.test(path)
}

/**
 * The templates the platform looks up by name.
 *
 * Not a theme's whole surface -- a theme may ship any snippets it likes, and one it
 * never renders is lean rather than wrong. These are the ones the Worker asks for
 * directly, once per page kind, so a theme without one answers that page with an
 * error rather than with a design. The upload refuses it there, where the author can
 * still do something about it.
 */
export const REQUIRED_TEMPLATES = [
  'layouts/base',
  'templates/404',
  'templates/home',
  'templates/page',
  'templates/post',
  'templates/posts',
  'templates/product',
  'templates/products',
] as const

function isTemplatePath(path: string): boolean {
  return TEMPLATE_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/** `assets/theme.css` → `theme.css`, which is the name a template asks for. */
function assetNameOf(path: string): string {
  return path.startsWith(ASSET_PREFIX) ? path.slice(ASSET_PREFIX.length) : path
}
