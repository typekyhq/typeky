import type { CachePort } from '../ports'

/**
 * The subset of the Workers `caches` global this adapter touches.
 *
 * Written structurally for the same reason as the D1 and R2 adapters: importing
 * the runtime type would drag Cloudflare into the codebase, which red line 3
 * forbids, and the package would stop being usable from Node.
 */

/** A `Request` or a URL string, which is what `caches.default` accepts as a key. */
export type CacheKey = Request | string

export interface CacheLikeStorages {
  /**
   * `caches.default`.
   *
   * Note what a miss is: `undefined` from the runtime and `null` here, because the
   * port speaks in `null` and the runtime's own habit would leak into every
   * caller.
   */
  match(key: CacheKey): Promise<Response | undefined>
  put(key: CacheKey, response: Response): Promise<void>
  /** Absent in a runtime that can read a cache but not forget from one. */
  delete?(key: CacheKey): Promise<boolean>
}

export function createEdgeCache(storages: CacheLikeStorages): CachePort {
  return {
    async match(key) {
      return (await storages.match(key)) ?? null
    },

    async put(key, response) {
      await storages.put(key, response)
    },

    async purgeByUrl(keys) {
      if (storages.delete === undefined) return

      // Together rather than in sequence: these are independent round trips and a
      // page's worth of them should cost one, not one each.
      await Promise.all(
        keys.map(async (key) => {
          await storages.delete?.(key)
        }),
      )
    },
  }
}

/**
 * The cache a request should use, or one that stores nothing.
 *
 * `caches` is a Worker global and is absent under Node, which is where the tests
 * run. Returning a cache that does nothing rather than throwing keeps that
 * difference from being a special case in the request path -- and a no-op cache
 * is also the honest answer if a runtime ever offers none.
 */
export function edgeCacheFrom(globals: { caches?: { default?: CacheLikeStorages } }): CachePort {
  const storages = globals.caches?.default
  if (storages === undefined) return NO_CACHE

  return createEdgeCache(storages)
}

const NO_CACHE: CachePort = {
  async match() {
    return null
  },
  async put() {
    return undefined
  },
  async purgeByUrl() {
    return undefined
  },
}
