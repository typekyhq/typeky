import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { MiddlewareHandler } from 'hono'
import type { Env } from '../env'
import { verifyPassword } from './password'
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_TTL_SECONDS,
  createSession,
  destroySession,
  readSession,
  type Session,
} from './session'

/**
 * The admin JSON API.
 *
 * Two rules hold for everything under here (architecture section 8):
 *   - every endpoint is behind a session, except the three that establish or
 *     inspect one;
 *   - the API is at `/api/admin/*`, physically separate from the site's public
 *     read-only API at `/api/v1/*`, so the two permission models never mix.
 */

export type AdminEnv = { Bindings: Env; Variables: { session: Session } }

const DEFAULT_ACTOR_ID = 'admin'

export function createAdminApi(): Hono<AdminEnv> {
  const api = new Hono<AdminEnv>()

  api.post('/session', async (c) => {
    const hash = c.env.ADMIN_PASSWORD_HASH
    if (hash === undefined || hash === '') {
      // Fail closed. A deployment that has not configured a password must not be
      // enterable, and the operator needs to be told why.
      console.error('admin login attempted but ADMIN_PASSWORD_HASH is not configured')
      return c.json({ error: 'admin_password_not_configured' }, 503)
    }

    const credentials = await readCredentials(c.req.raw)
    if (credentials === null) return c.json({ error: 'invalid_request' }, 400)

    // Verified even when the username is wrong, so response time does not reveal
    // whether the username was right.
    const passwordMatches = await verifyPassword(credentials.password, hash)
    const usernameMatches = credentials.username === (c.env.ADMIN_USERNAME ?? DEFAULT_ACTOR_ID)
    if (!usernameMatches || !passwordMatches) return c.json({ error: 'invalid_credentials' }, 401)

    const { id, session } = await createSession(c.env.CACHE, DEFAULT_ACTOR_ID)
    setCookie(c, SESSION_COOKIE, id, {
      ...SESSION_COOKIE_OPTIONS,
      maxAge: SESSION_TTL_SECONDS,
    })

    return c.json(session, 201)
  })

  api.delete('/session', async (c) => {
    const id = getCookie(c, SESSION_COOKIE)
    if (id !== undefined) await destroySession(c.env.CACHE, id)

    // Hono sets maxAge 0 itself, but the other attributes still have to match
    // what the cookie was set with.
    deleteCookie(c, SESSION_COOKIE, SESSION_COOKIE_OPTIONS)
    return c.body(null, 204)
  })

  api.get('/session', requireSession, (c) => c.json(c.get('session')))

  // Everything registered after this point needs a session.
  api.use('*', requireSession)
  api.all('*', (c) => c.json({ error: 'not_found' }, 404))

  return api
}

export const requireSession: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const session = await readSession(c.env.CACHE, getCookie(c, SESSION_COOKIE))

  if (session === null) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  c.set('session', session)
  await next()
}

async function readCredentials(request: Request): Promise<{ username: string; password: string } | null> {
  try {
    const body: unknown = await request.json()
    if (typeof body !== 'object' || body === null) return null

    const { username, password } = body as Record<string, unknown>
    if (typeof username !== 'string' || typeof password !== 'string') return null
    if (username === '' || password === '') return null

    return { username, password }
  } catch {
    return null
  }
}
