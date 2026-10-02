import { describe, expect, it } from 'vitest'
import { csrfTokenMatches, isSafeMethod, newCsrfToken } from './csrf'

describe('csrf tokens', () => {
  it('are 32 random bytes, header-safe', () => {
    const token = newCsrfToken()

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newCsrfToken()).not.toBe(token)
  })
})

describe('csrfTokenMatches', () => {
  it('accepts the exact token', () => {
    const token = newCsrfToken()

    expect(csrfTokenMatches(token, token)).toBe(true)
  })

  it('rejects a different token of the same length', () => {
    expect(csrfTokenMatches(newCsrfToken(), newCsrfToken())).toBe(false)
  })

  it('rejects a prefix, so a partial match is not a match', () => {
    const token = newCsrfToken()

    expect(csrfTokenMatches(token.slice(0, 20), token)).toBe(false)
  })

  it('rejects a missing or empty provided token', () => {
    const token = newCsrfToken()

    expect(csrfTokenMatches(undefined, token)).toBe(false)
    expect(csrfTokenMatches('', token)).toBe(false)
  })

  it('rejects when the session carries no token, rather than accepting anything', () => {
    expect(csrfTokenMatches('anything', '')).toBe(false)
  })
})

describe('isSafeMethod', () => {
  it('treats reads as safe', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(isSafeMethod(method)).toBe(true)
  })

  it('treats writes as unsafe', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(isSafeMethod(method)).toBe(false)
  })

  it('treats an unfamiliar method as unsafe, so a new route is protected by default', () => {
    expect(isSafeMethod('PROPFIND')).toBe(false)
  })
})
