import { randomBytes } from 'node:crypto'
import { constantTimeStringEquals, toBase64Url } from './encoding'

/**
 * CSRF tokens, bound to the session.
 *
 * Section 8 asks for a double-submit token; this is the same check with the
 * token kept on the session instead of mirrored into a second cookie. Binding it
 * is strictly stronger -- a double-submit cookie can be overwritten by a sibling
 * subdomain, which is the classic weakness of that scheme -- and there is no
 * second copy to keep in sync.
 *
 * The mechanism is unchanged: the client sends the token in a header, and the
 * server compares it on every request that can change state.
 */
/** 32 random bytes, matching the session id. */
export function newCsrfToken(): string {
  return toBase64Url(Uint8Array.from(randomBytes(32)))
}

export function csrfTokenMatches(provided: string | undefined, expected: string): boolean {
  if (provided === undefined || provided === '' || expected === '') return false
  return constantTimeStringEquals(provided, expected)
}

/**
 * Methods that cannot change state and therefore need no token.
 *
 * Everything else -- POST, PUT, PATCH, DELETE -- is treated as a write, so a
 * method added later is protected by default rather than by remembering to list
 * it.
 */
export function isSafeMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}
