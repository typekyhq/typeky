import { describe, expect, it } from 'vitest'
import { fakeKv } from '../testing/env'
import { SESSION_TTL_SECONDS, createSession, destroySession, newSessionId, readSession } from './session'

describe('session ids', () => {
  it('are 32 random bytes, cookie-safe', () => {
    const id = newSessionId()

    expect(id).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newSessionId()).not.toBe(id)
  })
})

describe('session store', () => {
  it('round-trips a session, csrf token included', async () => {
    const { kv } = fakeKv()

    const { id, session } = await createSession(kv, 'admin')

    expect(session.actorId).toBe('admin')
    expect(session.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await readSession(kv, id)).toEqual(session)
  })

  it('gives every session its own csrf token', async () => {
    const { kv } = fakeKv()

    const first = await createSession(kv, 'admin')
    const second = await createSession(kv, 'admin')

    expect(first.session.csrfToken).not.toBe(second.session.csrfToken)
  })

  it('sets an expiry, so sessions do not accumulate forever', async () => {
    const { kv, entries } = fakeKv()

    const { id } = await createSession(kv, 'admin')

    expect(entries.get(`session:${id}`)?.expirationTtl).toBe(SESSION_TTL_SECONDS)
  })

  it('returns null for an unknown, empty or missing id', async () => {
    const { kv } = fakeKv()

    expect(await readSession(kv, 'nope')).toBeNull()
    expect(await readSession(kv, '')).toBeNull()
    expect(await readSession(kv, undefined)).toBeNull()
  })

  it('treats an unparseable record as no session rather than an error', async () => {
    const { kv, entries } = fakeKv()
    entries.set('session:broken', { value: '{not json' })
    entries.set('session:wrong-shape', { value: '{"actorId":42}' })
    // A record with no csrf token is refused rather than trusted: an
    // authenticated request without a token to check against must not succeed.
    entries.set('session:no-token', { value: '{"actorId":"admin","createdAt":"2026-01-01T00:00:00.000Z"}' })

    expect(await readSession(kv, 'broken')).toBeNull()
    expect(await readSession(kv, 'wrong-shape')).toBeNull()
    expect(await readSession(kv, 'no-token')).toBeNull()
  })

  it('destroys a session', async () => {
    const { kv } = fakeKv()
    const { id } = await createSession(kv, 'admin')

    await destroySession(kv, id)

    expect(await readSession(kv, id)).toBeNull()
  })

  it('issues a distinct id per session, so logging in twice does not share one', async () => {
    const { kv } = fakeKv()

    const first = await createSession(kv, 'admin')
    const second = await createSession(kv, 'admin')

    expect(first.id).not.toBe(second.id)
    expect(await readSession(kv, first.id)).not.toBeNull()
    expect(await readSession(kv, second.id)).not.toBeNull()
  })
})
