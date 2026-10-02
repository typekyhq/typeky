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
      'SELECT path, source FROM theme_templates WHERE theme = ?',
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

    return map
  }

  /** One query per revision, shared by every lookup in that revision. */
  function overrides(): Promise<Map<string, string>> {
    if (loaded === undefined || loadedRevision !== revision) {
      loadedRevision = revision
      loaded = loadOverrides()
    }
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
