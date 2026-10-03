import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../contracts'
import { createD1Repositories } from '.'
import { createTestDatabase } from '../testing'

function setup() {
  return createD1Repositories(createTestDatabase())
}

const ctx = defaultContext()

const base = {
  tagline: null,
  logoMediaId: null,
  faviconMediaId: null,
  theme: 'default',
  settings: {},
  nav: [],
}

describe('site repository', () => {
  it('returns null before the row exists', async () => {
    expect(await setup().sites.get(ctx)).toBeNull()
  })

  it('creates the single row and reads it back with decoded columns', async () => {
    const { sites } = setup()

    const saved = await sites.save(ctx, {
      ...base,
      name: 'Typeky Demo',
      settings: { accentColor: '#111827', footer: 'Built with Typeky.' },
      nav: [{ label: 'Blog', href: '/posts', order: 1 }],
    })

    expect(saved.id).toBe('default')
    expect(saved.name).toBe('Typeky Demo')
    expect(saved.settings).toEqual({ accentColor: '#111827', footer: 'Built with Typeky.' })
    expect(saved.nav).toEqual([{ label: 'Blog', href: '/posts', order: 1 }])
    expect(saved.createdAt).toBeInstanceOf(Date)

    expect(await sites.get(ctx)).toEqual(saved)
  })

  it('replaces the row instead of adding one, and keeps created_at', async () => {
    const db = createTestDatabase()
    const { sites } = createD1Repositories(db)

    const first = await sites.save(ctx, { ...base, name: 'First' })
    const second = await sites.save(ctx, { ...base, name: 'Second', tagline: 'updated' })

    expect(second.id).toBe(first.id)
    expect(second.createdAt).toEqual(first.createdAt)
    expect(second.name).toBe('Second')
    expect(second.tagline).toBe('updated')

    const count = await db.first<{ total: number }>('SELECT count(*) AS total FROM sites')
    expect(count?.total).toBe(1)
  })
})
