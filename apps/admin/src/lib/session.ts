import type { ApiErrorCode, LoginRequest, Session } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, type ApiClient } from './api-client'

/**
 * Everything the shell needs to know about who is signed in.
 *
 * The session lives on the server; the only thing the browser keeps is the CSRF
 * token inside the API client. On load the client asks the server whether a
 * cookie is still valid, which is why the first state is `loading` rather than
 * `signedOut`.
 */

export type SessionState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; session: Session }
  /** The server answered, but not with a session. */
  | { status: 'unreachable'; message: string }

export interface SessionController {
  state: SessionState
  signIn(credentials: LoginRequest): Promise<void>
  /** Clears the local session even if the request fails, then rethrows. */
  signOut(): Promise<void>
  reload(): void
}

const MESSAGES: Record<ApiErrorCode, string> = {
  invalid_request: 'The server rejected that request.',
  unauthorized: 'Your session has ended. Sign in again.',
  csrf_failed: 'The session token was rejected. Reload the page and try again.',
  invalid_credentials: 'Wrong username or password.',
  admin_password_not_configured: 'No admin password is configured on this deployment.',
  database_not_configured: 'This deployment has no database configured.',
  not_found: 'That endpoint does not exist yet.',
  internal_error: 'The server could not complete the request.',
}

/** Turns any thrown value into something worth showing a person. */
export function describeApiError(thrown: unknown): string {
  if (thrown instanceof ApiError) return MESSAGES[thrown.code]
  if (thrown instanceof Error) return thrown.message
  return 'Something went wrong.'
}

export function useSession(client: ApiClient): SessionController {
  const [state, setState] = useState<SessionState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    client.loadSession().then(
      (session) => {
        if (!cancelled) setState({ status: 'signedIn', session })
      },
      (thrown: unknown) => {
        if (cancelled) return
        // A missing session is the normal state for a first visit; anything else
        // means the server could not be asked, and that is worth saying.
        if (thrown instanceof ApiError && thrown.code === 'unauthorized') {
          setState({ status: 'signedOut' })
        } else {
          setState({ status: 'unreachable', message: describeApiError(thrown) })
        }
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, attempt])

  const signIn = useCallback(
    async (credentials: LoginRequest) => {
      const session = await client.signIn(credentials)
      setState({ status: 'signedIn', session })
    },
    [client],
  )

  const signOut = useCallback(async () => {
    try {
      await client.signOut()
    } finally {
      // The client has already dropped its token, so the shell must not stay up
      // even if the request failed.
      setState({ status: 'signedOut' })
    }
  }, [client])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  return { state, signIn, signOut, reload }
}
