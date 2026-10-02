import type { LiquidOptions, Template } from 'liquidjs'

/**
 * Parsed-template cache keyed by revision.
 *
 * liquidjs keys its cache on `type + ':' + filename`, which is stable across
 * edits. A template override would therefore keep serving the parsed template it
 * replaced, so the revision has to go into the key -- and since liquidjs lets the
 * cache be supplied, this is where it goes.
 *
 * The cache holds parsed templates, which is the expensive part; the source read
 * goes through the loader's own memoised override map.
 */

type CacheValue = Template[] | Promise<Template[]>

/**
 * liquidjs does not export its `LiquidCache` type, so it is derived from the
 * option that accepts one.
 */
export type ParsedTemplateCache = Exclude<LiquidOptions['cache'], boolean | number | undefined>

export interface RevisionCacheOptions {
  /** Read on every access. A different value clears everything. */
  revision: () => number
  /** Least-recently-used eviction beyond this many templates. */
  maxEntries?: number
}

/** Section 3.7 caps the parse cache at 200 templates. */
export const DEFAULT_MAX_CACHED_TEMPLATES = 200

export function createRevisionCache(options: RevisionCacheOptions): ParsedTemplateCache {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_CACHED_TEMPLATES
  const entries = new Map<string, CacheValue>()
  let seenRevision = options.revision()

  function syncRevision(): void {
    const current = options.revision()
    if (current === seenRevision) return
    seenRevision = current
    entries.clear()
  }

  function evict(): void {
    while (entries.size > maxEntries) {
      const oldest = entries.keys().next()
      if (oldest.done === true) return
      entries.delete(oldest.value)
    }
  }

  return {
    read(key) {
      syncRevision()

      const value = entries.get(key)
      if (value === undefined) return undefined

      // Re-insert so the least recently used entry is evicted first.
      entries.delete(key)
      entries.set(key, value)
      return value
    },

    write(key, value) {
      syncRevision()
      entries.set(key, value)
      evict()
    },

    remove(key) {
      syncRevision()
      entries.delete(key)
    },
  }
}
