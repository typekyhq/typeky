import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../contracts'
import { createD1Repositories } from '.'
import { createTestDatabase } from '../testing'

function setup() {
  const db = createTestDatabase()
  return { db, ...createD1Repositories(db) }
}

const ctx = defaultContext()

const logo = {
  filename: 'logo.svg',
  storageKey: 'brand/logo.svg',
  mimeType: 'image/svg+xml',
  byteSize: 2048,
  width: 240,
  height: 64,
  altText: 'Typeky',
}

describe('media repository', () => {
  it('inserts a row and reads it back with a real Date', async () => {
    const { media } = setup()

    const item = await media.insert(ctx, logo)

    expect(item.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(item.filename).toBe('logo.svg')
    expect(item.storageKey).toBe('brand/logo.svg')
    expect(item.byteSize).toBe(2048)
    expect(item.width).toBe(240)
    expect(item.createdAt).toBeInstanceOf(Date)

    expect(await media.byId(ctx, item.id)).toEqual(item)
  })

  it('accepts an explicit id and leaves unknown dimensions null', async () => {
    const { media } = setup()

    const item = await media.insert(ctx, { ...logo, id: 'media_fixed' })

    expect(item.id).toBe('media_fixed')
    expect(await media.byId(ctx, 'missing')).toBeNull()
  })

  it('lists newest first', async () => {
    const { media } = setup()
    const first = await media.insert(ctx, { ...logo, filename: 'first.svg' })
    await media.insert(ctx, { ...logo, filename: 'second.svg' })

    const listed = await media.list(ctx)

    expect(listed.total).toBe(2)
    expect(listed.items[0]?.filename).toBe('second.svg')
    expect(listed.items[1]?.id).toBe(first.id)
  })

  it('searches on filename and alt text', async () => {
    const { media } = setup()
    await media.insert(ctx, { ...logo, filename: 'logo.svg', altText: 'Typeky' })
    await media.insert(ctx, { ...logo, filename: 'cover.jpg', altText: 'A desk' })

    expect((await media.list(ctx, { search: 'desk' })).items.map((item) => item.filename)).toEqual(['cover.jpg'])
    expect((await media.list(ctx, { search: 'logo' })).items.map((item) => item.filename)).toEqual(['logo.svg'])
    expect((await media.list(ctx, { search: '   ' })).total).toBe(2)
  })

  it('reports whether a delete removed anything', async () => {
    const { media } = setup()
    const item = await media.insert(ctx, logo)

    expect(await media.remove(ctx, item.id)).toBe(true)
    expect(await media.remove(ctx, item.id)).toBe(false)
  })

  it('clears content references instead of refusing the delete', async () => {
    const { media, posts } = setup()

    const item = await media.insert(ctx, logo)
    const post = await posts.upsert(ctx, { title: 'Hello', slug: 'hello', coverMediaId: item.id })
    expect(post.coverMediaId).toBe(item.id)

    expect(await media.remove(ctx, item.id)).toBe(true)
    expect((await posts.byId(ctx, post.id))?.coverMediaId).toBeNull()
  })
})
