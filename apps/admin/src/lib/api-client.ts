import {
  CSRF_HEADER,
  apiErrorBodySchema,
  getPostListResponseSchema,
  getPostResponseSchema,
  sessionSchema,
  siteResponseSchema,
  type ApiErrorCode,
  type ContentStatus,
  type LoginRequest,
  type PostListResponse,
  type PostResponse,
  type PostWrite,
  type Session,
  type SiteResponse,
  type SiteWrite,
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
  /**
   * The server's own explanation, when it sent one.
   *
   * Kept separate from `message` so a caller can tell "the server said why"
   * from "the constructor fell back to the code", which is what decides whether
   * the curated client-side wording is worth showing instead.
   */
  readonly serverMessage: string | undefined

  constructor(code: ApiErrorCode, status: number, message?: string) {
    super(message ?? code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.serverMessage = message
  }
}

export interface ApiClient {
  /** The token for the current session, or undefined while signed out. */
  readonly csrfToken: string | undefined
  setCsrfToken(token: string | undefined): void

  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  put<T>(path: string, body?: unknown): Promise<T>
  delete(path: string): Promise<void>

  signIn(credentials: LoginRequest): Promise<Session>
  signOut(): Promise<void>
  loadSession(): Promise<Session>

  getSite(): Promise<SiteResponse>
  saveSite(site: SiteWrite): Promise<SiteResponse>

  listPosts(query?: PostQuery): Promise<PostListResponse>
  getPost(id: string): Promise<PostResponse>
  createPost(post: PostWrite): Promise<PostResponse>
  savePost(id: string, post: PostWrite): Promise<PostResponse>
  deletePost(id: string): Promise<void>
  setPostStatus(id: string, status: ContentStatus): Promise<PostResponse>
}

/** The filters the list screen can ask for. */
export interface PostQuery {
  status?: ContentStatus
  /** Matched against title, slug and excerpt. */
  search?: string
  limit?: number
  offset?: number
}

/**
 * What a contract check needs from a schema.
 *
 * Written structurally rather than importing Zod's type: this package is the
 * only thing the SPA needs from the contract, and zod/mini's types are an
 * implementation detail of how those schemas were written.
 */
interface Shape<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false }
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
    return readContract(sessionSchema, response, 'the session response did not match the contract')
  }

  /**
   * Validates a success body against its contract.
   *
   * Only the endpoints whose shapes are defined check; a generic `get<T>` is a
   * typed cast by design, because the caller usually has the schema for later.
   */
  async function readContract<T>(shape: Shape<T>, response: Response, message: string): Promise<T> {
    const parsed = shape.safeParse(await response.json())
    if (!parsed.success) throw new ApiError('internal_error', response.status, message)
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

    async put<T>(path: string, body?: unknown): Promise<T> {
      return (await (await send('PUT', path, body)).json()) as T
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

    async getSite() {
      return readContract(siteResponseSchema, await send('GET', '/site'), 'the site response did not match the contract')
    },

    async saveSite(site) {
      return readContract(
        siteResponseSchema,
        await send('PUT', '/site', site),
        'the save response did not match the contract',
      )
    },

    async listPosts(query = {}) {
      return readContract(
        getPostListResponseSchema(),
        await send('GET', `/posts${toQueryString(query)}`),
        'the post list did not match the contract',
      )
    },

    async getPost(id) {
      return readContract(
        getPostResponseSchema(),
        await send('GET', `/posts/${encodeURIComponent(id)}`),
        'the post did not match the contract',
      )
    },

    async createPost(post) {
      return readContract(
        getPostResponseSchema(),
        await send('POST', '/posts', post),
        'the save response did not match the contract',
      )
    },

    async savePost(id, post) {
      return readContract(
        getPostResponseSchema(),
        await send('PUT', `/posts/${encodeURIComponent(id)}`, post),
        'the save response did not match the contract',
      )
    },

    async deletePost(id) {
      await send('DELETE', `/posts/${encodeURIComponent(id)}`)
    },

    async setPostStatus(id, status) {
      return readContract(
        getPostResponseSchema(),
        await send('POST', `/posts/${encodeURIComponent(id)}/status`, { status }),
        'the status response did not match the contract',
      )
    },
  }

  return client
}

/**
 * Only the filters that were set reach the URL, so a request without a search
 * term cannot be answered from a different cache entry than a request for
 * everything.
 */
function toQueryString(query: PostQuery): string {
  const params = new URLSearchParams()

  if (query.status !== undefined) params.set('status', query.status)
  if (query.search !== undefined && query.search.trim() !== '') params.set('search', query.search.trim())
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined && query.offset > 0) params.set('offset', String(query.offset))

  const encoded = params.toString()
  return encoded === '' ? '' : `?${encoded}`
}
