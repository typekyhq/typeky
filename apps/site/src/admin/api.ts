import { API_ERROR_STATUS, type ApiErrorBody, type ApiErrorCode } from '@typeky/api'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { Context, MiddlewareHandler } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Env } from '../env'
import { CSRF_HEADER, csrfTokenMatches, isSafeMethod } from './csrf'
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
 * Rules for everything under here (architecture sections 3.3 and 8):
 *   - the API lives at `/api/admin/*`, physically separate from the site's
 *     public read-only API at `/api/v1/*`, so the two permission models never
 *     mix;
 *   - every endpoint needs a session, and every endpoint that can change state
 *     also needs the CSRF token that belongs to that session;
 *   - the only exceptions are the two that establish or end a session, which are
 *     registered before the guards on purpose. See the note on each.
 */

export type AdminEnv = { Bindings: Env; Variables: { session: Session } }

const DEFAULT_ACTOR_ID = 'admin'

/**
 * One error shape for every endpoint, with the status derived from the code so
 * the two cannot disagree.
 */
function apiError(c: Context<AdminEnv>, code: ApiErrorCode): Response {
  return c.json({ error: code } satisfies ApiErrorBody, API_ERROR_STATUS[code] as ContentfulStatusCode)
}

export function createAdminApi(): Hono<AdminEnv> {
  const api = new Hono<AdminEnv>()

  // Login carries no CSRF token because there is no session yet to bind one to.
  // A forged login would sign the victim into the only account that exists, and
  // SameSite=Lax already keeps a cross-site POST from carrying a session cookie.
  api.post('/session', async (c) => {
    const hash = c.env.ADMIN_PASSWORD_HASH
    if (hash === undefined || hash === '') {
      // Fail closed. A deployment that has not configured a password must not be
      // enterable, and the operator needs to be told why.
      console.error('admin login attempted but ADMIN_PASSWORD_HASH is not configured')
      return apiError(c, 'admin_password_not_configured')
    }

    const credentials = await readCredentials(c.req.raw)
    if (credentials === null) return apiError(c, 'invalid_request')

    // Verified even when the username is wrong, so response time does not reveal
    // whether the username was right.
    const passwordMatches = await verifyPassword(credentials.password, hash)
    const usernameMatches = credentials.username === (c.env.ADMIN_USERNAME ?? DEFAULT_ACTOR_ID)
    if (!usernameMatches || !passwordMatches) return apiError(c, 'invalid_credentials')

    const { id, session } = await createSession(c.env.CACHE, DEFAULT_ACTOR_ID)
    setCookie(c, SESSION_COOKIE, id, { ...SESSION_COOKIE_OPTIONS, maxAge: SESSION_TTL_SECONDS })

    return c.json(session, 201)
  })

  // Logout stays outside the guards so it is idempotent: a client that has lost
  // its cookie can still clear the one in its browser. It therefore also skips
  // the CSRF check, which is an accepted trade-off -- the worst a forged logout
  // achieves is signing somebody out.
  api.delete('/session', async (c) => {
    const id = getCookie(c, SESSION_COOKIE)
    if (id !== undefined) await destroySession(c.env.CACHE, id)

    // Hono sets maxAge 0 itself, but the other attributes still have to match
    // what the cookie was set with.
    deleteCookie(c, SESSION_COOKIE, SESSION_COOKIE_OPTIONS)
    return c.body(null, 204)
  })

  api.get('/session', requireSession, (c) => c.json(c.get('session')))

  // Everything registered after this point needs a session...
  api.use('*', requireSession)
  // ...and anything that can change state also needs the token.
  api.use('*', requireCsrf)

  api.all('*', (c) => apiError(c, 'not_found'))

  return api
}

export const requireSession: MiddlewareHandler<AdminEnv> = async (c, next) => {
  const session = await readSession(c.env.CACHE, getCookie(c, SESSION_COOKIE))

  if (session === null) return apiError(c, 'unauthorized')

  c.set('session', session)
  await next()
}

/**
 * Compares the header against the token stored on the session.
 *
 * Runs after `requireSession`, so the session is always present here.
 */
export const requireCsrf: MiddlewareHandler<AdminEnv> = async (c, next) => {
  if (isSafeMethod(c.req.method)) return next()

  const expected = c.get('session').csrfToken
  const provided = c.req.header(CSRF_HEADER)

  if (!csrfTokenMatches(provided, expected)) return apiError(c, 'csrf_failed')

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
