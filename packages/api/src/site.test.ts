import { describe, expect, it } from 'vitest'
import { navItemSchema, siteResponseSchema, siteSettingsSchema, siteWriteSchema } from './site'

const site = {
  name: 'Typeky Demo',
  tagline: 'A small site',
  logoMediaId: null,
  faviconMediaId: null,
  theme: 'default',
  settings: {},
  nav: [],
}

describe('navItemSchema', () => {
  it('accepts a label, a link and a position', () => {
    expect(navItemSchema.safeParse({ label: 'Home', href: '/', order: 0 }).success).toBe(true)
  })

  it('rejects an empty label or link', () => {
    expect(navItemSchema.safeParse({ label: '', href: '/', order: 0 }).success).toBe(false)
    expect(navItemSchema.safeParse({ label: 'Home', href: '', order: 0 }).success).toBe(false)
  })

  it('rejects a position that is not a whole number', () => {
    expect(navItemSchema.safeParse({ label: 'Home', href: '/', order: 1.5 }).success).toBe(false)
    expect(navItemSchema.safeParse({ label: 'Home', href: '/', order: -1 }).success).toBe(false)
  })
})

describe('siteSettingsSchema', () => {
  it('accepts an empty object, since every setting has a default', () => {
    expect(siteSettingsSchema.parse({})).toEqual({})
  })

  it('accepts a six digit hex colour', () => {
    expect(siteSettingsSchema.safeParse({ accentColor: '#1a2B3c' }).success).toBe(true)
  })

  it('rejects anything else as a colour', () => {
    for (const value of ['red', '#fff', '#12345g', 'rgb(1,2,3)', '']) {
      expect(siteSettingsSchema.safeParse({ accentColor: value }).success, value).toBe(false)
    }
  })

  it('caps the social links, because they end up in the footer', () => {
    const link = { label: 'GitHub', href: 'https://example.com' }

    expect(siteSettingsSchema.safeParse({ socialLinks: Array.from({ length: 10 }, () => link) }).success).toBe(true)
    expect(siteSettingsSchema.safeParse({ socialLinks: Array.from({ length: 11 }, () => link) }).success).toBe(false)
  })

  it('drops a field it does not recognise, rather than storing it', () => {
    // Stripping rather than rejecting: a stale client that sends an extra key
    // should not fail the save, but the JSON column must not accumulate it.
    expect(siteSettingsSchema.parse({ accentColour: '#000000' })).toEqual({})
    expect(siteSettingsSchema.parse({ accentColor: '#000000', accentColour: '#ffffff' })).toEqual({
      accentColor: '#000000',
    })
  })
})

describe('siteWriteSchema', () => {
  it('accepts a minimal document', () => {
    expect(siteWriteSchema.safeParse(site).success).toBe(true)
  })

  it('requires a name and a theme', () => {
    expect(siteWriteSchema.safeParse({ ...site, name: '' }).success).toBe(false)
    expect(siteWriteSchema.safeParse({ ...site, theme: '' }).success).toBe(false)
  })

  it('accepts a missing or null tagline', () => {
    const { tagline: _omitted, ...withoutTagline } = site

    expect(siteWriteSchema.safeParse(withoutTagline).success).toBe(true)
    expect(siteWriteSchema.safeParse({ ...site, tagline: null }).success).toBe(true)
  })

  it('caps the navigation list', () => {
    const item = { label: 'Home', href: '/', order: 0 }

    expect(siteWriteSchema.safeParse({ ...site, nav: Array.from({ length: 20 }, () => item) }).success).toBe(true)
    expect(siteWriteSchema.safeParse({ ...site, nav: Array.from({ length: 21 }, () => item) }).success).toBe(false)
  })

  it('reports which field failed, which is what the form needs', () => {
    const parsed = siteWriteSchema.safeParse({
      ...site,
      nav: [{ label: '', href: '/', order: 0 }],
    })

    expect(parsed.success).toBe(false)
    if (parsed.success) return
    expect(parsed.error.issues.map((issue) => issue.path.join('.'))).toEqual(['nav.0.label'])
  })
})

describe('siteResponseSchema', () => {
  it('accepts what the endpoint sends back', () => {
    const response = { ...site, updatedAt: '2026-01-01T00:00:00.000Z' }

    expect(siteResponseSchema.parse(response)).toEqual(response)
  })

  it('requires the timestamp, which is how the client knows a save landed', () => {
    expect(siteResponseSchema.safeParse(site).success).toBe(false)
  })
})
