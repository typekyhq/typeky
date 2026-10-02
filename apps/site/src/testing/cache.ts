import type { CachePort } from '@typeky/platform'

/**
 * A cache that keeps things in a Map.
 *
 * It records what was purged as well as what was stored, because "a publish
 * forgets the right URLs" is a claim about side effects and not about the next
 * read: a purge that forgot nothing and a purge that forgot everything look the
 * same from the outside afterwards.
 *
 * A hit comes back with headers that cannot be changed, which is the Workerd
 * Cache API's behaviour and not an accident of this double. Getting that wrong
 * the first time is why it is here: a `Response` built in a test has mutable
 * headers, so a fake that returned one hid a real crash -- `headers.set` on a
 * cached response throws in a Worker, and does nothing at all in Node.
 */
export interface FakeCache extends CachePort {
  entries: Map<string, Response>
  /** Every key ever passed to `purgeByUrl`, in order. */
  purges: string[]
}

export function fakeCache(): FakeCache {
  const entries = new Map<string, Response>()
  const purges: string[] = []

  return {
    entries,
    purges,

    async match(key) {
      const entry = entries.get(key)
      if (entry === undefined) return null

      // A clone, because a Response body reads once and a test that inspects a
      // hit should not consume the thing the next assertion needs.
      return withImmutableHeaders(entry.clone())
    },

    async put(key, response) {
      entries.set(key, response)
    },

    async purgeByUrl(keys) {
      for (const key of keys) {
        purges.push(key)
        entries.delete(key)
      }
    },
  }
}

/** What the runtime does to the headers of anything it hands back from its cache. */
function withImmutableHeaders(response: Response): Response {
  const headers = response.headers
  const guard = new Proxy(headers, {
    get(target, property, receiver) {
      if (property === 'set' || property === 'append' || property === 'delete') {
        return () => {
          throw new TypeError("Can't modify immutable headers.")
        }
      }

      const value = Reflect.get(target, property, receiver)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })

  Object.defineProperty(response, 'headers', { value: guard })

  return response
}
