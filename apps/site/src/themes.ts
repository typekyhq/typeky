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
 * The bundled theme's list is its baseline in code; an uploaded theme's is its own
 * files **over** the bundled ones, because a theme is layered rather than complete: a
 * file it does not ship is a file it did not change, and it renders with the bundled
 * one. That is also why the list is the union -- what the operator sees here is what
 * the theme renders, and a file that answers a page has to be visible to be edited.
 */
export async function themeTemplates(store: Repositories, theme: string): Promise<ThemeFile[]> {
  const rows = await store.themeTemplates.list(defaultContext(), theme)
  const byPath = new Map(rows.map((row) => [row.path, row]))

  const shipped = rows.filter((row) => isTemplatePath(row.path)).map((row) => row.path)
  const paths = [...new Set([...BASELINE_NAMES, ...shipped])].sort()

  return paths.map((path) => {
    const row = byPath.get(path)

    return {
      path,
      source: row?.source ?? (BASELINE[path] as string | undefined) ?? '',
      // A row with no `originalSource` is an override of a bundled file; one with an
      // original is a file the theme shipped, edited when the two differ.
      edited:
        row === undefined
          ? false
          : row.originalSource === null || row.originalSource !== row.source,
      updatedAt: row?.updatedAt ?? null,
    }
  })
}

/** The source a theme shipped a file as, or null when the theme has no such file. */
export async function themeFileOriginal(
  store: Repositories,
  theme: string,
  path: string,
): Promise<string | null> {
  if (theme === BUNDLED_THEME) return (BASELINE[path] as string | undefined) ?? null

  const row = await store.themeTemplates.byPath(defaultContext(), theme, path)
  if (row !== null) return row.originalSource ?? row.source

  // A file this theme leaves to the bundled one is still a file the theme renders, so
  // it can be edited -- and restoring it drops the override, exactly as it does for a
  // file the bundled theme ships.
  return (BASELINE[path] as string | undefined) ?? null
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
  const own = Object.fromEntries(
    rows
      .filter((row) => isTemplatePath(row.path))
      .map((row) => [row.path, row.originalSource ?? row.source]),
  )

  // Layered over the bundled theme rather than replacing it: a file this theme does
  // not ship renders with the bundled one, so the set has to include it too.
  return { ...BASELINE, ...own }
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
  // The bundled theme needs no query, and asking for one would be a read of a table it
  // does not use -- which is also what keeps a site with no rows cheap to render.
  if (theme === BUNDLED_THEME) return { ...ASSET_VERSIONS }

  const rows = await store.themeTemplates.list(defaultContext(), theme)
  const own = Object.fromEntries(
    rows
      .filter((row) => !isTemplatePath(row.path))
      .map((row) => [assetNameOf(row.path), String(row.updatedAt.getTime())]),
  )

  // The bundled versions are the floor, for the same reason the templates are: a theme
  // that ships no stylesheet is served the bundled one, and its URL has to be the one
  // the bundled stylesheet's bytes are cached under.
  return { ...ASSET_VERSIONS, ...own }
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

function isTemplatePath(path: string): boolean {
  return TEMPLATE_PREFIXES.some((prefix) => path.startsWith(prefix))
}

/** `assets/theme.css` → `theme.css`, which is the name a template asks for. */
function assetNameOf(path: string): string {
  return path.startsWith(ASSET_PREFIX) ? path.slice(ASSET_PREFIX.length) : path
}
