import { describe, expect, it } from 'vitest'
import { API_ERROR_CODES, apiErrorBodySchema } from './errors'
import { loginRequestSchema, sessionSchema } from './session'

describe('loginRequestSchema', () => {
  it('accepts a username and password', () => {
    expect(loginRequestSchema.safeParse({ username: 'admin', password: 'hunter2' }).success).toBe(true)
  })

  it('rejects an empty username or password, which the endpoint would reject anyway', () => {
    expect(loginRequestSchema.safeParse({ username: '', password: 'hunter2' }).success).toBe(false)
    expect(loginRequestSchema.safeParse({ username: 'admin', password: '' }).success).toBe(false)
  })

  it('rejects a missing field or a wrong type', () => {
    expect(loginRequestSchema.safeParse({ username: 'admin' }).success).toBe(false)
    expect(loginRequestSchema.safeParse({ username: 1, password: 'hunter2' }).success).toBe(false)
    expect(loginRequestSchema.safeParse('admin').success).toBe(false)
    expect(loginRequestSchema.safeParse(null).success).toBe(false)
  })

  it('strips unknown fields rather than letting them through', () => {
    const parsed = loginRequestSchema.parse({ username: 'admin', password: 'hunter2', admin: true })

    expect(parsed).toEqual({ username: 'admin', password: 'hunter2' })
  })

  it('bounds the input, so an enormous body cannot reach the password hash', () => {
    expect(loginRequestSchema.safeParse({ username: 'a'.repeat(201), password: 'x' }).success).toBe(false)
    expect(loginRequestSchema.safeParse({ username: 'a', password: 'x'.repeat(1001) }).success).toBe(false)
  })
})

describe('sessionSchema', () => {
  const session = {
    actorId: 'admin',
    csrfToken: 'a-token',
    createdAt: '2026-01-01T00:00:00.000Z',
  }

  it('accepts a session record', () => {
    expect(sessionSchema.parse(session)).toEqual(session)
  })

  it('rejects a record with no csrf token, so one written by an older version is not trusted', () => {
    const { csrfToken: _omitted, ...withoutToken } = session

    expect(sessionSchema.safeParse(withoutToken).success).toBe(false)
  })

  it('rejects an empty token rather than accepting a blank one', () => {
    expect(sessionSchema.safeParse({ ...session, csrfToken: '' }).success).toBe(false)
  })
})

describe('apiErrorBodySchema', () => {
  it('accepts every declared code', () => {
    for (const code of API_ERROR_CODES) {
      expect(apiErrorBodySchema.safeParse({ error: code }).success, code).toBe(true)
    }
  })

  it('rejects a code that is not declared', () => {
    expect(apiErrorBodySchema.safeParse({ error: 'teapot' }).success).toBe(false)
  })

  it('accepts an optional message alongside the code', () => {
    const parsed = apiErrorBodySchema.parse({ error: 'not_found', message: 'no such page' })

    expect(parsed).toEqual({ error: 'not_found', message: 'no such page' })
  })

  it('rejects a body with no code at all', () => {
    expect(apiErrorBodySchema.safeParse({ message: 'something went wrong' }).success).toBe(false)
  })
})
