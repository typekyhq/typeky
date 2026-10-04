import type { ApiErrorCode, LoginRequest, Session } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { ApiError, type ApiClient } from './api-client'
import { useT, type Translate } from './i18n'

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

/** Error code to locale key. The words live in the locale file with the rest. */
const ERROR_KEYS: Record<ApiErrorCode, string> = {
  invalid_request: 'error.invalid_request',
  unauthorized: 'error.unauthorized',
  csrf_failed: 'error.csrf_failed',
  invalid_credentials: 'error.invalid_credentials',
  too_many_attempts: 'error.too_many_attempts',
  admin_password_not_configured: 'error.admin_password_not_configured',
  database_not_configured: 'error.database_not_configured',
  not_found: 'error.not_found',
  slug_taken: 'error.slug_taken',
  slug_reserved: 'error.slug_reserved',
  name_taken: 'error.name_taken',
  storage_not_configured: 'error.storage_not_configured',
  internal_error: 'error.internal_error',
}

/**
 * Turns any thrown value into something worth showing a person.
 *
 * The translator is a parameter rather than a hook because this is called from
 * places that are not components -- and because a screen that forgot to pass one
 * should be a type error, not a panel that silently speaks English.
 */
export function describeApiError(thrown: unknown, t: Translate): string {
  if (thrown instanceof ApiError) {
    // The server's words when it sent any. A slug conflict names the post that
    // already holds the slug, and no table of per-code wording can say that.
    return thrown.serverMessage ?? t(ERROR_KEYS[thrown.code])
  }

  if (thrown instanceof Error) return thrown.message
  return t('error.unknown')
}

export function useSession(client: ApiClient): SessionController {
  /**
   * The default language, not the operator's.
   *
   * The preference is stored in the site document, which is behind the session --
   * so before somebody has signed in there is nothing to read and nothing to be
   * wrong about. The messages this function produces are exactly the pre-auth
   * ones.
   */
  const t = useT()
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
          setState({ status: 'unreachable', message: describeApiError(thrown, t) })
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
