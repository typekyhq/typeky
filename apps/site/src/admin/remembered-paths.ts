/**
 * The paths that were in force at the last purge.
 *
 * Kept rather than recomputed, because the one URL a recomputation cannot find is
 * the one that has just left the set -- an unpublished page, a changed slug, a
 * deleted one -- and that is exactly the URL that most needs forgetting. A cached
 * 200 outlives its row by up to `s-maxage`, so a page the operator has taken down
 * would otherwise keep being served for five minutes.
 *
 * What is stored is the current set and not a growing history: a URL is forgotten
 * on the write that removes it, and what is left is what the next purge still has
 * to name.
 *
 * So the read is tolerant and the value is a cache of a cache. Losing it costs the
 * next purge some precision -- for a URL removed in the meantime -- and that is
 * worth a good deal less than a save that fails because of it.
 */
const KEY = 'revalidate:paths'

export async function readRememberedPaths(cache: KVNamespace): Promise<string[]> {
  const raw = await cache.get(KEY)
  if (raw === null) return []

  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []

    return parsed.filter((path): path is string => typeof path === 'string')
  } catch {
    // Not something this wrote. Starting over costs one purge's precision.
    return []
  }
}

export async function rememberPaths(cache: KVNamespace, paths: readonly string[]): Promise<void> {
  await cache.put(KEY, JSON.stringify(paths))
}
