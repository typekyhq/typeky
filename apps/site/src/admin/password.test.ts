import { describe, expect, it } from 'vitest'
import { constantTimeEquals, fromBase64Url, toBase64Url } from './encoding'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, verifyPassword, type ScryptParams } from './password'

/** Cheap parameters: the production cost has its own measurement, not a test. */
const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }

describe('base64url', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 255, 42])
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
  })

  it('produces a cookie-safe alphabet, without padding', () => {
    const encoded = toBase64Url(Uint8Array.from([251, 255, 190]))
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('handles all three padding lengths', () => {
    for (const length of [1, 2, 3, 4, 5]) {
      const bytes = Uint8Array.from({ length }, (_value, index) => index + 1)
      expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes)
    }
  })
})

describe('constantTimeEquals', () => {
  it('accepts equal byte strings', () => {
    expect(constantTimeEquals(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3]))).toBe(true)
  })

  it('rejects a difference anywhere', () => {
    expect(constantTimeEquals(Uint8Array.from([1, 2, 3]), Uint8Array.from([9, 2, 3]))).toBe(false)
    expect(constantTimeEquals(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 9]))).toBe(false)
  })

  it('rejects different lengths', () => {
    expect(constantTimeEquals(Uint8Array.from([1, 2]), Uint8Array.from([1, 2, 3]))).toBe(false)
  })
})

describe('password hashing', () => {
  it('accepts the password it hashed', async () => {
    const encoded = await hashPassword('correct horse battery staple', FAST)

    expect(await verifyPassword('correct horse battery staple', encoded)).toBe(true)
  })

  it('rejects a different password', async () => {
    const encoded = await hashPassword('correct horse battery staple', FAST)

    expect(await verifyPassword('correct horse battery stapl', encoded)).toBe(false)
    expect(await verifyPassword('', encoded)).toBe(false)
  })

  it('salts every hash, so the same password never hashes twice the same', async () => {
    const first = await hashPassword('same', FAST)
    const second = await hashPassword('same', FAST)

    expect(first).not.toBe(second)
  })

  it('stores the cost alongside the hash', async () => {
    const encoded = await hashPassword('pw', FAST)

    expect(encoded.split('$').slice(0, 4)).toEqual(['scrypt', '1024', '8', '1'])
  })

  it('verifies a hash made with different parameters, so raising the cost is not a migration', async () => {
    const cheap = await hashPassword('pw', { ...DEFAULT_SCRYPT_PARAMS, N: 512 })
    const expensive = await hashPassword('pw', { ...DEFAULT_SCRYPT_PARAMS, N: 2048 })

    expect(await verifyPassword('pw', cheap)).toBe(true)
    expect(await verifyPassword('pw', expensive)).toBe(true)
  })

  it('denies rather than throws on a malformed stored value', async () => {
    for (const malformed of [
      '',
      'not-a-hash',
      'scrypt$1024$8$1$onlyfiveparts',
      'bcrypt$1024$8$1$c2FsdA$aGFzaA',
      'scrypt$abc$8$1$c2FsdA$aGFzaA',
      'scrypt$1024$8$1$c2FsdA$',
    ]) {
      expect(await verifyPassword('pw', malformed), malformed).toBe(false)
    }
  })
})
