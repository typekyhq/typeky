import { describe, expect, it } from 'vitest'
import { PLATFORM_PATHS, firstPathSegment, reservedPathFor } from './paths'

/**
 * Reserved paths.
 *
 * The rule exists because a page's URL is `/<slug>`: a page slugged `admin` would
 * take the address the panel is served from, and the operator would have locked
 * themselves out of their own site. What is worth pinning here is the matching,
 * because it is deliberately coarser than path equality.
 */
describe('the first path segment', () => {
  it('normalises what a person writes in a list', () => {
    expect(firstPathSegment('install')).toBe('install')
    expect(firstPathSegment('/install')).toBe('install')
    expect(firstPathSegment('  /install/  ')).toBe('install')
    expect(firstPathSegment('/Install')).toBe('install')
    expect(firstPathSegment('/shop/new')).toBe('shop')
  })

  it('is empty for nothing at all', () => {
    expect(firstPathSegment('')).toBe('')
    expect(firstPathSegment('   ')).toBe('')
    expect(firstPathSegment('/')).toBe('')
  })
})

describe('reserving a path', () => {
  it('refuses a slug the platform serves itself', () => {
    // The one that would hurt most: the panel's own address.
    expect(reservedPathFor('admin', [])).toBe('/admin')
    expect(reservedPathFor('api', [])).toBe('/api')
    // The lists, which the resolver answers before any page.
    expect(reservedPathFor('posts', [])).toBe('/posts')
    expect(reservedPathFor('products', [])).toBe('/products')
  })

  it('refuses one the operator reserved', () => {
    expect(reservedPathFor('install', ['/install'])).toBe('/install')
    expect(reservedPathFor('shop', ['shop'])).toBe('shop')
  })

  it('reserves a whole branch by its first segment', () => {
    // A page is one segment deep, so `/shop/new` can only ever mean `shop` here.
    // The finer rule would reserve less than the operator meant.
    expect(reservedPathFor('shop', ['/shop/new'])).toBe('/shop/new')
  })

  it('allows a slug that merely starts like a reserved one', () => {
    expect(reservedPathFor('api-docs', ['/api'])).toBeNull()
    expect(reservedPathFor('administrator', ['/admin'])).toBeNull()
  })

  it('allows an ordinary slug', () => {
    expect(reservedPathFor('about', ['/install'])).toBeNull()
  })

  it('says nothing about an empty slug, which validation refuses elsewhere', () => {
    expect(reservedPathFor('', ['/install'])).toBeNull()
  })

  it('names the platform paths it holds', () => {
    // The list is the contract; a route added to the Worker has to be added here,
    // and the test that the app agrees with this lives where the app is.
    expect(PLATFORM_PATHS).toContain('/admin')
    expect(PLATFORM_PATHS).toContain('/api')
  })
})
