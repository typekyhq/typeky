import { describe, expect, it } from 'vitest'
import { createEdgeCache, edgeCacheFrom, type CacheLikeStorages } from './cache'

/**
 * The edge-cache adapter.
 *
 * Two of its jobs are worth pinning: turning the runtime's `undefined` miss into
 * the port's `null`, and doing the deletes together rather than one after another
 * -- a page's worth of round trips should cost one, not one each.
 */

function storages(): CacheLikeStorages & { stored: Map<string, Response>; calls: string[] } {
  const stored = new Map<string, Response>()
  const calls: string[] = []

  return {
    stored,
    calls,
    async match(key) {
      return stored.get(typeof key === 'string' ? key : key.url)
    },
    async put(key, response) {
      stored.set(typeof key === 'string' ? key : key.url, response)
    },
    async delete(key) {
      return stored.delete(typeof key === 'string' ? key : key.url)
    },
  }
}

describe('createEdgeCache', () => {
  it('answers a miss with null rather than undefined', async () => {
    // The port speaks in null; letting the runtime's habit through would make
    // every caller check for two absences.
    await expect(createEdgeCache(storages()).match('https://example.com/')).resolves.toBeNull()
  })

  it('round-trips a response', async () => {
    const cache = createEdgeCache(storages())
    await cache.put('https://example.com/', new Response('<p>page</p>'))

    const hit = await cache.match('https://example.com/')
    await expect(hit?.text()).resolves.toBe('<p>page</p>')
  })

  it('forgets every key it is given', async () => {
    const underneath = storages()
    const cache = createEdgeCache(underneath)
    await cache.put('https://example.com/a', new Response('a'))
    await cache.put('https://example.com/b', new Response('b'))

    await cache.purgeByUrl(['https://example.com/a', 'https://example.com/b'])

    await expect(cache.match('https://example.com/a')).resolves.toBeNull()
    await expect(cache.match('https://example.com/b')).resolves.toBeNull()
  })

  it('does not fail when the runtime cannot forget', async () => {
    // A runtime that can read a cache but not delete from one is a real shape,
    // and a purge is not worth an exception: the expiry is the backstop.
    const withoutDelete: CacheLikeStorages = {
      async match() {
        return undefined
      },
      async put() {
        return undefined
      },
    }

    await expect(createEdgeCache(withoutDelete).purgeByUrl(['https://example.com/'])).resolves.toBeUndefined()
  })
})

describe('edgeCacheFrom', () => {
  it('stores nothing when the runtime has no cache', async () => {
    const cache = edgeCacheFrom({})

    await expect(cache.match('https://example.com/')).resolves.toBeNull()
    // The no-op has to accept a purge too, or every caller needs a branch.
    await expect(cache.purgeByUrl(['https://example.com/'])).resolves.toBeUndefined()
  })

  it('uses the default store when there is one', async () => {
    const underneath = storages()
    const cache = edgeCacheFrom({ caches: { default: underneath } })

    await cache.put('https://example.com/', new Response('page'))

    expect(underneath.stored.has('https://example.com/')).toBe(true)
  })
})
