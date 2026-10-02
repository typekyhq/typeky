import { randomBytes } from 'node:crypto'
import { toBase64Url } from './encoding'

/**
 * Admin sessions, stored in KV.
 *
 * Red line 12 allows KV for sessions and nothing else: a session is a
 * self-contained record that can be rebuilt by logging in again, which is
 * exactly the shape KV is good at. Anything that needs a strong consistency
 * guarantee does not belong here.
 */

/** The `__Host-` prefix requires Secure, Path=/ and no Domain attribute. */
export const SESSION_COOKIE = '__Host-typeky_session'

/**
 * The attributes the session cookie is set with.
 *
 * Shared between setting and clearing on purpose: Hono refuses to serialise a
 * `__Host-` cookie without `secure`, and a delete that does not repeat the same
 * attributes can leave the browser holding the old cookie.
 */
export const SESSION_COOKIE_OPTIONS = {
  path: '/',
  httpOnly: true,
  secure: true,
  sameSite: 'Lax',
} as const

/**
 * Seven days, fixed.
 *
 * KV expiry is set at write time, so a sliding window would mean writing on
 * every authenticated request. A fixed lifetime is cheaper and predictable.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

export interface Session {
  actorId: string
  createdAt: string
}

const KEY_PREFIX = 'session:'

/** 32 random bytes: guessing one is not a practical attack. */
export function newSessionId(): string {
  return toBase64Url(Uint8Array.from(randomBytes(32)))
}

export async function createSession(
  cache: KVNamespace,
  actorId: string,
): Promise<{ id: string; session: Session }> {
  const id = newSessionId()
  const session: Session = { actorId, createdAt: new Date().toISOString() }

  await cache.put(KEY_PREFIX + id, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS })
  return { id, session }
}

export async function readSession(cache: KVNamespace, id: string | undefined): Promise<Session | null> {
  if (id === undefined || id === '') return null

  const raw = await cache.get(KEY_PREFIX + id)
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const { actorId, createdAt } = parsed as Record<string, unknown>
    if (typeof actorId !== 'string' || typeof createdAt !== 'string') return null
    return { actorId, createdAt }
  } catch {
    // A value that cannot be parsed is treated as no session rather than an
    // error: the correct response is to ask the operator to sign in again.
    return null
  }
}

export async function destroySession(cache: KVNamespace, id: string): Promise<void> {
  await cache.delete(KEY_PREFIX + id)
}
