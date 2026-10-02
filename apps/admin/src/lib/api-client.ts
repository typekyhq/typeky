import {
  CSRF_HEADER,
  apiErrorBodySchema,
  sessionSchema,
  type ApiErrorCode,
  type LoginRequest,
  type Session,
} from '@typeky/api'

/**
 * The one place the admin SPA talks to `/api/admin/*`.
 *
 * Hand-rolled fetch at each call site means every one of them has to remember
 * the CSRF header, the JSON content type, and how to turn an error body into
 * something throwable. Doing it once is what keeps those from drifting.
 */

/** Every non-2xx response becomes one of these. */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number

  constructor(code: ApiErrorCode, status: number, message?: string) {
    super(message ?? code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

export interface ApiClient {
  /** The token for the current session, or undefined while signed out. */
  readonly csrfToken: string | undefined
  setCsrfToken(token: string | undefined): void

  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  delete(path: string): Promise<void>

  signIn(credentials: LoginRequest): Promise<Session>
  signOut(): Promise<void>
  loadSession(): Promise<Session>
}

export interface ApiClientOptions {
  /** Defaults to `/api/admin`, which the Worker serves and Vite proxies. */
  baseUrl?: string
  /** Injected by tests; defaults to the global fetch. */
  fetch?: typeof globalThis.fetch
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
  const baseUrl = options.baseUrl ?? '/api/admin'
  const doFetch: typeof globalThis.fetch =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init))

  let csrfToken: string | undefined

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers = new Headers()
    if (body !== undefined) headers.set('content-type', 'application/json')

    // Only writes carry the token: a read has nothing to forge, and putting it
    // on every request only widens where it can be logged.
    if (!SAFE_METHODS.has(method) && csrfToken !== undefined) headers.set(CSRF_HEADER, csrfToken)

    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      headers,
      // The default, but this is the reason the __Host- session cookie travels,
      // so it is worth stating rather than relying on a default.
      credentials: 'same-origin',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

    if (response.ok) return response

    const error = await toApiError(response)
    // The session is gone; holding on to its token would only produce 403s.
    if (error.code === 'unauthorized') csrfToken = undefined
    throw error
  }

  async function toApiError(response: Response): Promise<ApiError> {
    try {
      const parsed = apiErrorBodySchema.safeParse(await response.json())
      if (parsed.success) return new ApiError(parsed.data.error, response.status, parsed.data.message)
    } catch {
      // Not JSON, so something failed before the API layer could answer.
    }

    return new ApiError('internal_error', response.status)
  }

  async function readSession(response: Response): Promise<Session> {
    const parsed = sessionSchema.safeParse(await response.json())
    if (!parsed.success) {
      throw new ApiError('internal_error', response.status, 'the session response did not match the contract')
    }
    return parsed.data
  }

  const client: ApiClient = {
    get csrfToken() {
      return csrfToken
    },

    setCsrfToken(token) {
      csrfToken = token
    },

    async get<T>(path: string): Promise<T> {
      return (await (await send('GET', path)).json()) as T
    },

    async post<T>(path: string, body?: unknown): Promise<T> {
      return (await (await send('POST', path, body)).json()) as T
    },

    async delete(path: string): Promise<void> {
      await send('DELETE', path)
    },

    async signIn(credentials) {
      const session = await readSession(await send('POST', '/session', credentials))
      csrfToken = session.csrfToken
      return session
    },

    async signOut() {
      try {
        await send('DELETE', '/session')
      } finally {
        // Even a sign-out that failed must leave the client without a token.
        csrfToken = undefined
      }
    },

    async loadSession() {
      const session = await readSession(await send('GET', '/session'))
      csrfToken = session.csrfToken
      return session
    },
  }

  return client
}
