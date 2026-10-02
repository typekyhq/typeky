import type { DbPort } from '@typeky/platform'
import { describe, expect, it } from 'vitest'
import { createTemplateLoader } from './loader'
import { createRevisionCache } from './cache'

/**
 * Saved means live, in every isolate.
 *
 * The revision a parsed-template cache keys on used to be a counter inside the
 * loader, which only the isolate that handled the save ever bumped: every other
 * isolate kept rendering what it had loaded, for as long as it lived. Deriving
 * the revision from the rows is what fixes that, and this is the test that says
 * so -- a loader built *later*, as a later request would build one, sees the
 * change without being told.
 */

const BASELINE = {
  'templates/post': 'baseline post',
  'snippets/footer': 'baseline footer',
}

/** A database whose rows can be changed between loads, as a save would. */
function mutableDb(initial: { path: string; source: string; revision: number }[]) {
  let rows = [...initial]

  const db: DbPort = {
    async all<T>() {
      return rows as T[]
    },
    async first<T>() {
      return null as T | null
    },
    async run() {
      return 0
    },
    async batch() {
      return undefined
    },
  }

  return {
    db,
    save(path: string, source: string) {
      const existing = rows.find((row) => row.path === path)
      rows = existing === undefined
        ? [...rows, { path, source, revision: 1 }]
        : rows.map((row) => (row.path === path ? { ...row, source, revision: row.revision + 1 } : row))
    },
    reset(path: string) {
      rows = rows.filter((row) => row.path !== path)
    },
  }
}

function loaderFor(db: DbPort) {
  return createTemplateLoader({ db, theme: 'default', baseline: BASELINE })
}

describe('a save is visible to the next loader', () => {
  it('reads what was saved, without being told to invalidate anything', async () => {
    const store = mutableDb([])

    // Before the save.
    expect(await loaderFor(store.db).read('templates/post')).toBe('baseline post')

    store.save('templates/post', 'edited post')

    // A *new* loader, which is what the next request builds. Nothing called
    // `invalidate()` on this instance; it cannot have been told.
    const after = loaderFor(store.db)
    expect(await after.read('templates/post')).toBe('edited post')
    expect(await after.isOverridden('templates/post')).toBe(true)
  })

  it('moves the revision, so a parse cache keyed on it misses', async () => {
    const store = mutableDb([])

    const before = loaderFor(store.db)
    await before.read('templates/post')
    const revisionBefore = before.revision

    store.save('templates/post', 'edited post')

    const after = loaderFor(store.db)
    await after.read('templates/post')

    // This is the whole point: the cache in `createRevisionCache` namespaces by
    // `loader.revision`, so a changed revision is a cache miss -- a stale parse
    // would render the old template forever.
    expect(after.revision).not.toBe(revisionBefore)
  })

  it('goes back to the baseline when the override is dropped', async () => {
    const store = mutableDb([{ path: 'snippets/footer', source: 'custom footer', revision: 1 }])

    expect(await loaderFor(store.db).read('snippets/footer')).toBe('custom footer')

    store.reset('snippets/footer')

    const after = loaderFor(store.db)
    expect(await after.read('snippets/footer')).toBe('baseline footer')
    expect(await after.isOverridden('snippets/footer')).toBe(false)
  })

  it('does not reload when nothing changed, so a render is one query', async () => {
    let queries = 0
    const store = mutableDb([{ path: 'snippets/footer', source: 'custom', revision: 1 }])
    const counting: DbPort = {
      ...store.db,
      async all<T>() {
        queries += 1
        return store.db.all<T>('')
      },
    }

    const loader = loaderFor(counting)

    // A render reads several templates; the overrides are read once for it.
    await loader.read('templates/post')
    await loader.read('snippets/footer')
    await loader.read('snippets/footer')

    expect(queries).toBe(1)
  })

  it('keeps a long-lived loader on the revision it already read', async () => {
    const store = mutableDb([{ path: 'snippets/footer', source: 'first', revision: 1 }])
    const loader = loaderFor(store.db)

    expect(await loader.read('snippets/footer')).toBe('first')

    store.save('snippets/footer', 'second')

    // Still the first: this instance loaded that revision and nothing told it
    // otherwise. The fix is that the *next* loader sees the change (above), not
    // that a loader watches the database.
    expect(await loader.read('snippets/footer')).toBe('first')

    loader.invalidate()
    expect(await loader.read('snippets/footer')).toBe('second')
  })

  it('namespaces the parse cache by the revision, not by the template name alone', async () => {
    const store = mutableDb([{ path: 'templates/post', source: 'first', revision: 1 }])
    const loader = loaderFor(store.db)
    const cache = createRevisionCache({ revision: () => loader.revision })

    await loader.read('templates/post')
    cache.write('template:templates/post', { parsed: 'first' } as never)
    expect(cache.read('template:templates/post')).toBeDefined()

    store.save('templates/post', 'second')
    loader.invalidate()
    await loader.read('templates/post')

    // Same key, different revision: a miss. Without the namespacing, liquidjs's
    // own cache key (type + name) would keep handing back the old parse.
    expect(cache.read('template:templates/post')).toBeUndefined()
  })
})
