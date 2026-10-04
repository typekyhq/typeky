import { DEFAULT_ADMIN_PATH } from '@typeky/api'
import { describe, expect, it } from 'vitest'
import { adminPathOf } from './admin-config'

/**
 * Reading the panel's address out of a settings row.
 *
 * Every request asks this, so the answers that matter are the defensive ones: a row
 * written by hand, or by a version that stored something else, has to leave the panel
 * reachable rather than answer nowhere at all.
 */

describe('reading the panel address', () => {
  it('is the stored segment when there is one', () => {
    expect(adminPathOf({ admin: { path: 'x7f2k9' } })).toBe('x7f2k9')
    // The default is a valid choice, and refusing it would make it impossible to
    // write back.
    expect(adminPathOf({ admin: { path: 'admin' } })).toBe('admin')
  })

  it('is the default when nothing is set', () => {
    expect(adminPathOf(undefined)).toBe(DEFAULT_ADMIN_PATH)
    expect(adminPathOf(null)).toBe(DEFAULT_ADMIN_PATH)
    expect(adminPathOf({})).toBe(DEFAULT_ADMIN_PATH)
    expect(adminPathOf({ admin: {} })).toBe(DEFAULT_ADMIN_PATH)
  })

  it('ignores a value that could not have been saved', () => {
    expect(adminPathOf({ admin: { path: 'Posts' } })).toBe(DEFAULT_ADMIN_PATH)
    expect(adminPathOf({ admin: { path: 'a/b' } })).toBe(DEFAULT_ADMIN_PATH)
    expect(adminPathOf({ admin: { path: 'posts' } })).toBe(DEFAULT_ADMIN_PATH)
    expect(adminPathOf({ admin: { path: 42 } })).toBe(DEFAULT_ADMIN_PATH)
    expect(adminPathOf({ admin: 'nonsense' })).toBe(DEFAULT_ADMIN_PATH)
  })
})
