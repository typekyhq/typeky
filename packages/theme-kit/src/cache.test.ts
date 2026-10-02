import type { Template } from 'liquidjs'
import { describe, expect, it } from 'vitest'
import { createRevisionCache, DEFAULT_MAX_CACHED_TEMPLATES } from './cache'

function value(id: string): Template[] {
  return [{ id } as unknown as Template]
}

function setup(maxEntries?: number) {
  const revision = { current: 1 }
  const cache = createRevisionCache({ revision: () => revision.current, maxEntries })
  return { cache, revision }
}

describe('revision cache', () => {
  it('serves a value within the same revision', () => {
    const { cache } = setup()

    cache.write('root:templates/post', value('a'))

    expect(cache.read('root:templates/post')).toEqual(value('a'))
  })

  it('misses on an unknown key', () => {
    const { cache } = setup()

    expect(cache.read('root:nope')).toBeUndefined()
  })

  it('drops everything when the revision changes', () => {
    const { cache, revision } = setup()
    cache.write('root:templates/post', value('a'))

    revision.current = 2

    expect(cache.read('root:templates/post')).toBeUndefined()
  })

  it('keeps entries written after the revision changed', () => {
    const { cache, revision } = setup()
    cache.write('root:old', value('old'))

    revision.current = 2
    cache.write('root:new', value('new'))

    expect(cache.read('root:new')).toEqual(value('new'))
    expect(cache.read('root:old')).toBeUndefined()
  })

  it('removes one entry without touching the rest', () => {
    const { cache } = setup()
    cache.write('root:a', value('a'))
    cache.write('root:b', value('b'))

    cache.remove('root:a')

    expect(cache.read('root:a')).toBeUndefined()
    expect(cache.read('root:b')).toEqual(value('b'))
  })

  it('evicts the least recently used entry past the cap', () => {
    const { cache } = setup(2)
    cache.write('root:a', value('a'))
    cache.write('root:b', value('b'))
    cache.write('root:c', value('c'))

    expect(cache.read('root:a')).toBeUndefined()
    expect(cache.read('root:b')).toEqual(value('b'))
    expect(cache.read('root:c')).toEqual(value('c'))
  })

  it('refreshes recency on read, so a hot entry is not evicted', () => {
    const { cache } = setup(2)
    cache.write('root:a', value('a'))
    cache.write('root:b', value('b'))

    // Reading `a` makes `b` the least recently used.
    expect(cache.read('root:a')).toEqual(value('a'))
    cache.write('root:c', value('c'))

    expect(cache.read('root:a')).toEqual(value('a'))
    expect(cache.read('root:b')).toBeUndefined()
  })

  it('defaults the cap to the documented 200 templates', () => {
    expect(DEFAULT_MAX_CACHED_TEMPLATES).toBe(200)

    const { cache } = setup()
    for (let index = 0; index < 201; index += 1) cache.write(`root:${index}`, value(`${index}`))

    expect(cache.read('root:0')).toBeUndefined()
    expect(cache.read('root:200')).toEqual(value('200'))
  })
})
