import type { FS } from 'liquidjs'
import type { DbPort } from '@typeky/platform'

/**
 * The two-level template loader (architecture section 3.7).
 *
 * Lookup is a single `??`: site override first, bundled baseline second. Keeping
 * both behind one code path is deliberate -- a separate "baseline is bundled,
 * overrides are in the database" pair of branches is how the two drift apart.
 *
 * The security property is the whitelist. `contains` only accepts a name the
 * theme actually ships, and since overrides cannot introduce a new path (red
 * line 8), the baseline *is* the complete set of readable names -- so the check
 * needs no database read at all.
 */

export interface TemplateLoaderOptions {
  db: DbPort
  theme: string
  /** Bundled templates: normalised name to source. */
  baseline: Record<string, string>
  /**
   * One unsaved template that takes precedence over both the stored override and
   * the baseline.
   *
   * The preview's mechanism, and the reason it belongs here rather than in a
   * separate loader: a preview that resolved names by a different path would be
   * answering a different question than the one the site will answer.
   */
  draft?: { path: string; source: string }
  /** Section 3.7 caps overrides at 200 templates and 1 MB of source. */
  maxOverrides?: number
  maxOverrideBytes?: number
}

export const DEFAULT_MAX_OVERRIDES = 200
export const DEFAULT_MAX_OVERRIDE_BYTES = 1_000_000

export interface TemplateLoader {
  /** Hand to the Liquid engine as its `fs`. */
  readonly fs: FS
  /** Bumped by `invalidate`, and part of every cache key. */
  readonly revision: number
  /** Called after a template is saved or reset. */
  invalidate(): void
  /** Names the admin may edit: the baseline set, never anything else. */
  list(): string[]
  /** Current source for a name: override if present, otherwise baseline. */
  read(name: string): Promise<string>
  /** Whether this name currently has an override rather than the baseline. */
  isOverridden(name: string): Promise<boolean>
}

interface OverrideRow {
  path: string
  source: string
  /** The row's own revision. Part of what tells one isolate the overrides moved. */
  revision: number
}

const LIQUID_EXTENSION = '.liquid'

/** `./snippets/header.liquid` and `/snippets/header` both become `snippets/header`. */
function toKey(file: string): string {
  const withoutExtension = file.endsWith(LIQUID_EXTENSION)
    ? file.slice(0, -LIQUID_EXTENSION.length)
    : file
  return withoutExtension.replace(/^\/+/, '')
}

export function createTemplateLoader(options: TemplateLoaderOptions): TemplateLoader {
  const maxOverrides = options.maxOverrides ?? DEFAULT_MAX_OVERRIDES
  const maxOverrideBytes = options.maxOverrideBytes ?? DEFAULT_MAX_OVERRIDE_BYTES
  const baseline = options.baseline
  const draft = options.draft

  let revision = 1
  let loadedRevision = -1
  let loaded: Promise<Map<string, string>> | undefined

  async function loadOverrides(): Promise<Map<string, string>> {
    const rows = await options.db.all<OverrideRow>(
      'SELECT path, source, revision FROM theme_templates WHERE theme = ?',
      [options.theme],
    )

    if (rows.length > maxOverrides) {
      throw new Error(
        `theme "${options.theme}" has ${rows.length} template overrides, over the ${maxOverrides} limit`,
      )
    }

    let bytes = 0
    const map = new Map<string, string>()
    for (const row of rows) {
      bytes += row.source.length
      map.set(toKey(row.path), row.source)
    }

    if (bytes > maxOverrideBytes) {
      throw new Error(
        `theme "${options.theme}" overrides total ${bytes} characters, over the ${maxOverrideBytes} limit`,
      )
    }

    // Derived from what was read, not from a counter in this process.
    //
    // A counter is only ever bumped by `invalidate()`, which only the isolate
    // that handled the save ever calls: every other isolate keeps rendering the
    // template it loaded, for as long as the isolate lives. Reading the revision
    // out of the rows is what makes "saved" mean "live" everywhere at once, and
    // it costs nothing extra -- this is the same query that fetched the rows.
    revision = hashRevision(rows)

    return map
  }

  /**
   * A stable number for a set of overrides.
   *
   * `path` and the row's own revision are enough: a save bumps that revision, so
   * any change to any override moves this. The source itself is deliberately not
   * hashed -- it is the largest column, and the row's revision already changes
   * whenever it does.
   */
  function hashRevision(rows: OverrideRow[]): number {
    const signature = rows
      .map((row) => `${row.path}:${String(row.revision)}`)
      .sort()
      .join('|')

    let hash = 1
    for (let index = 0; index < signature.length; index += 1) {
      hash = (hash * 31 + signature.charCodeAt(index)) % 2_147_483_647
    }

    return hash
  }

  /**
   * The overrides, read once per load.
   *
   * Memoised by the revision the *rows* produced, not by a counter here, so a
   * loader that is rebuilt for a request sees whatever was saved since -- even if
   * it was saved in another isolate, which is the only way "saved" can mean
   * "live" everywhere at once.
   *
   * `loadedRevision` is set when the load finishes rather than when it starts: the
   * revision is derived from the rows, so it changes *during* the load, and
   * writing it early would make every load look stale to the one after it.
   */
  function overrides(): Promise<Map<string, string>> {
    if (loaded !== undefined && loadedRevision === revision) return loaded

    loaded = loadOverrides().then((map) => {
      loadedRevision = revision
      return map
    })

    return loaded
  }

  function isKnown(file: string): boolean {
    // Names the theme does not ship are refused outright, which is stricter than
    // rejecting path shapes: it cannot be walked around, because there is no
    // path that both traverses and names a real template.
    if (file.includes('..')) return false
    return Object.hasOwn(baseline, toKey(file))
  }

  async function read(name: string): Promise<string> {
    const key = toKey(name)

    // The name check comes first, before anything is looked up or loaded.
    //
    // `fs.contains` runs ahead of this during a render, which is what makes the
    // documented property -- the whitelist needs no database read -- true for
    // pages. Doing it here as well covers the other callers, and covers a row
    // that arrived some other way than the API: an override whose path climbs
    // out of the theme would otherwise be served by a plain `read`.
    if (!isKnown(key)) throw new Error(`template not found: ${name}`)

    // The draft wins over both, which is what makes a preview honest: the editor
    // is showing a version of this file that is not stored yet.
    if (draft !== undefined && draft.path === key) return draft.source

    const source = (await overrides()).get(key) ?? baseline[key]
    if (source === undefined) throw new Error(`template not found: ${name}`)
    return source
  }

  function synchronousRenderingUnsupported(): never {
    throw new Error('the theme loader is asynchronous; synchronous rendering is not supported')
  }

  const fs: FS = {
    async contains(_root, file) {
      return isKnown(file)
    },

    // Safe to answer without IO: overrides never add a name the baseline lacks.
    containsSync(_root, file) {
      return isKnown(file)
    },

    async exists(file) {
      const key = toKey(file)
      // The whitelist first, for the same reason read does it: an override row
      // for a name the theme does not ship must not make that name look like a
      // file that is there. Answering yes and then failing to read it would turn
      // an injection into a 500 on the page that asked.
      if (!isKnown(key)) return false
      return (await overrides()).has(key) || Object.hasOwn(baseline, key)
    },

    existsSync() {
      return synchronousRenderingUnsupported()
    },

    readFile(file) {
      return read(file)
    },

    readFileSync() {
      return synchronousRenderingUnsupported()
    },

    // Names are resolved against the theme root, so the directory is ignored and
    // the result is the normalised name the whitelist checks.
    resolve(_dir, file) {
      return toKey(file)
    },

    sep: '/',
  }

  return {
    fs,

    get revision() {
      return revision
    },

    invalidate() {
      revision += 1
    },

    list() {
      return Object.keys(baseline).sort()
    },

    read,

    async isOverridden(name) {
      if (draft !== undefined && draft.path === toKey(name)) return true
      return (await overrides()).has(toKey(name))
    },
  }
}
