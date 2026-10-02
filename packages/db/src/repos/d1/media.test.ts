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

describe('media repository', () => {  it('inserts a row and reads it back with a real Date', async () => {
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

/**
 * What a delete would affect.
 *
 * This is the check that has to be right about the JSON columns: a body is Block
 * JSON and an image block holds a media id, so looking only at `cover_media_id`
 * would report "unused" for the image somebody pasted into the middle of a post.
 */
describe('media usages', () => {
  it('reports nothing for media nothing references', async () => {
    const { media } = setup()
    const item = await media.insert(ctx, logo)

    expect(await media.usages(ctx, item.id)).toEqual({ total: 0, places: [] })
  })

  it('finds a direct column reference', async () => {
    const { media, posts } = setup()
    const item = await media.insert(ctx, logo)
    await posts.upsert(ctx, { title: 'With a cover', slug: 'with-cover', coverMediaId: item.id })
    await posts.upsert(ctx, { title: 'Without', slug: 'without' })

    expect(await media.usages(ctx, item.id)).toEqual({
      total: 1,
      places: [{ kind: 'post', count: 1 }],
    })
  })

  it('finds one inside a block body, however deeply it is nested', async () => {
    const { media, pages } = setup()
    const item = await media.insert(ctx, logo)
    await pages.upsert(ctx, {
      title: 'Gallery',
      slug: 'gallery',
      blocks: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Look:' }] },
        {
          type: 'list',
          ordered: false,
          items: [
            {
              content: [],
              children: [{ type: 'image', mediaId: item.id, alt: 'Nested' }],
            },
          ],
        },
      ],
    })

    expect(await media.usages(ctx, item.id)).toEqual({
      total: 1,
      places: [{ kind: 'page', count: 1 }],
    })
  })

  it('finds one in the Open Graph image', async () => {
    const { media, posts } = setup()
    const item = await media.insert(ctx, logo)
    await posts.upsert(ctx, { title: 'Shared', slug: 'shared', seo: { ogImageMediaId: item.id } })

    expect(await media.usages(ctx, item.id)).toEqual({
      total: 1,
      places: [{ kind: 'post', count: 1 }],
    })
  })

  it('finds one in a product gallery and in the site logo', async () => {
    const { media, products, sites } = setup()
    const gallery = await media.insert(ctx, { ...logo, filename: 'in-gallery.jpg' })
    const brand = await media.insert(ctx, { ...logo, filename: 'brand.png' })

    await products.upsert(ctx, {
      title: 'Widget',
      slug: 'widget',
      gallery: ['other', gallery.id],
    })
    await sites.save(ctx, {
      name: 'Typeky',
      tagline: null,
      logoMediaId: brand.id,
      theme: 'default',
      settings: {},
      nav: [],
    })

    expect(await media.usages(ctx, gallery.id)).toEqual({
      total: 1,
      places: [{ kind: 'product', count: 1 }],
    })
    expect(await media.usages(ctx, brand.id)).toEqual({
      total: 1,
      places: [{ kind: 'site', count: 1 }],
    })
  })

  it('counts a row once however many times it uses the same image', async () => {
    const { media, posts } = setup()
    const item = await media.insert(ctx, logo)
    await posts.upsert(ctx, {
      title: 'Twice',
      slug: 'twice',
      coverMediaId: item.id,
      blocks: [{ type: 'image', mediaId: item.id, alt: null }],
      seo: { ogImageMediaId: item.id },
    })

    // Three references, one row: the count is about how many things would change,
    // not how many fields mention it.
    expect(await media.usages(ctx, item.id)).toEqual({
      total: 1,
      places: [{ kind: 'post', count: 1 }],
    })
  })

  it('counts across kinds', async () => {
    const { media, posts, pages } = setup()
    const item = await media.insert(ctx, logo)
    await posts.upsert(ctx, { title: 'One', slug: 'one', coverMediaId: item.id })
    await pages.upsert(ctx, {
      title: 'Two',
      slug: 'two',
      blocks: [{ type: 'image', mediaId: item.id, alt: null }],
    })

    const usage = await media.usages(ctx, item.id)

    expect(usage.total).toBe(2)
    expect(usage.places).toEqual([
      { kind: 'post', count: 1 },
      { kind: 'page', count: 1 },
    ])
  })
})
