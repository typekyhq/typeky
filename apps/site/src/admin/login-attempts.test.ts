import { describe, expect, it } from 'vitest'
import { fakeKv } from '../testing/env'
import {
  LOGIN_WINDOW_SECONDS,
  MAX_LOGIN_FAILURES,
  clearLoginFailures,
  loginClientKey,
  readLoginFailures,
  recordLoginFailure,
} from './login-attempts'

/**
 * The ceiling on how many times anybody may guess.
 *
 * scrypt is the floor under a single attempt; this is what stops a script from
 * trying forever, so what is worth pinning is the shape of the window: five
 * attempts, fifteen minutes from the *first* failure, and a clean slate after a
 * correct password.
 */

function request(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/api/admin/session', { method: 'POST', headers })
}

describe('which client an attempt belongs to', () => {
  it('trusts the address Cloudflare reports', () => {
    expect(loginClientKey(request({ 'cf-connecting-ip': '203.0.113.7' }))).toBe('203.0.113.7')
  })

  it('ignores a forwarded header when Cloudflare has spoken', () => {
    // A caller can set `x-forwarded-for`; they cannot set `cf-connecting-ip`.
    expect(
      loginClientKey(request({ 'cf-connecting-ip': '203.0.113.7', 'x-forwarded-for': '10.0.0.1' })),
    ).toBe('203.0.113.7')
  })

  it('falls back to the first hop of a forwarded chain', () => {
    expect(loginClientKey(request({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' }))).toBe(
      '198.51.100.4',
    )
  })

  it('shares one counter when it cannot tell clients apart', () => {
    // Erring towards locking out rather than towards letting a script through: a
    // request with no address of its own shares the bucket everything unaddressed
    // lands in.
    expect(loginClientKey(request())).toBe('unknown')
  })
})

describe('counting wrong passwords', () => {
  it('locks on the last one, and says how long to wait', async () => {
    const { kv } = fakeKv()

    for (let attempt = 1; attempt <= MAX_LOGIN_FAILURES; attempt += 1) {
      const state = await recordLoginFailure(kv, 'a')

      expect(state.count).toBe(attempt)
      expect(state.locked).toBe(attempt === MAX_LOGIN_FAILURES)
    }

    const read = await readLoginFailures(kv, 'a')

    expect(read.locked).toBe(true)
    expect(read.retryAfterSeconds).toBeGreaterThan(0)
    expect(read.retryAfterSeconds).toBeLessThanOrEqual(LOGIN_WINDOW_SECONDS)
  })

  it('expires the counter, so a window ends by itself', async () => {
    const { kv, entries } = fakeKv()

    await recordLoginFailure(kv, 'a')

    expect(entries.get('login-fail:a')?.expirationTtl).toBe(LOGIN_WINDOW_SECONDS)
  })

  it('does not extend the window with more failures', async () => {
    // A fixed window: five attempts per window rather than a lockout that grows
    // every time somebody tries again.
    const { kv, entries } = fakeKv()
    entries.set('login-fail:a', {
      value: JSON.stringify({ count: 1, firstAt: Date.now() - 300_000 }),
    })

    const state = await recordLoginFailure(kv, 'a')

    expect(state.count).toBe(2)
    expect(state.retryAfterSeconds).toBe(LOGIN_WINDOW_SECONDS - 300)
    expect(entries.get('login-fail:a')?.expirationTtl).toBe(LOGIN_WINDOW_SECONDS - 300)
  })

  it('starts a new window once the old one has run out', async () => {
    const { kv, entries } = fakeKv()
    entries.set('login-fail:a', {
      value: JSON.stringify({
        count: MAX_LOGIN_FAILURES,
        firstAt: Date.now() - (LOGIN_WINDOW_SECONDS + 1) * 1000,
      }),
    })

    const state = await recordLoginFailure(kv, 'a')

    expect(state.count).toBe(1)
    expect(state.locked).toBe(false)
  })

  it('reads nothing for a client that has no record', async () => {
    const { kv } = fakeKv()

    expect(await readLoginFailures(kv, 'nobody')).toEqual({
      locked: false,
      count: 0,
      retryAfterSeconds: 0,
    })
  })

  it('treats an unreadable record as no failures rather than as an error', async () => {
    const { kv, entries } = fakeKv()
    entries.set('login-fail:broken', { value: '{not json' })
    entries.set('login-fail:wrong-shape', { value: '{"count":"five"}' })

    expect(await readLoginFailures(kv, 'broken')).toEqual({ locked: false, count: 0, retryAfterSeconds: 0 })
    expect(await readLoginFailures(kv, 'wrong-shape')).toEqual({
      locked: false,
      count: 0,
      retryAfterSeconds: 0,
    })
  })

  it('forgets everything once the password turns out to be right', async () => {
    const { kv } = fakeKv()

    await recordLoginFailure(kv, 'a')
    await recordLoginFailure(kv, 'a')
    await clearLoginFailures(kv, 'a')

    expect(await readLoginFailures(kv, 'a')).toEqual({ locked: false, count: 0, retryAfterSeconds: 0 })
  })

  it('counts each client separately', async () => {
    const { kv } = fakeKv()

    for (let attempt = 0; attempt < MAX_LOGIN_FAILURES; attempt += 1) await recordLoginFailure(kv, 'a')

    expect((await readLoginFailures(kv, 'a')).locked).toBe(true)
    expect((await readLoginFailures(kv, 'b')).locked).toBe(false)
  })
})
