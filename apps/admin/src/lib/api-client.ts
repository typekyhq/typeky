import {
  CSRF_HEADER,
  apiErrorBodySchema,
  brandingResponseSchema,
  getPageListResponseSchema,
  getPageResponseSchema,
  getPostListResponseSchema,
  getPostResponseSchema,
  getProductListResponseSchema,
  getProductResponseSchema,
  mediaListResponseSchema,
  mediaItemSchema,
  mediaUsageSchema,
  bulkResultSchema,
  themeContextResponseSchema,
  themeListResponseSchema,
  themeTemplateListResponseSchema,
  themeTemplateResponseSchema,
  themePreviewResponseSchema,
  sessionSchema,
  licenseResponseSchema,
  overviewResponseSchema,
  siteResponseSchema,
  taxonomyResponseSchema,
  termSchema,
  vocabularySchema,
  type ApiErrorCode,
  type BulkAction,
  type BulkResult,
  type ContentSort,
  type ContentStatus,
  type BrandingResponse,
  type ThemeListResponse,
  type ThemeUpload,
  type LoginRequest,
  type MediaItem,
  type MediaListResponse,
  type MediaMetadata,
  type MediaUsage,
  type PageListResponse,
  type PageResponse,
  type PageWrite,
  type PostListResponse,
  type PostResponse,
  type PostWrite,
  type ProductListResponse,
  type ProductResponse,
  type ProductWrite,
  type Session,
  type LicenseResponse,
  type OverviewResponse,
  type SiteResponse,
  type SiteWrite,
  type SortDirection,
  type TaxonomyResponse,
  type Term,
  type TermWrite,
  type ThemeContextResponse,
  type ThemePreviewResponse,
  type ThemeTemplateListResponse,
  type ThemeTemplateResponse,
  type Vocabulary,
  type VocabularyWrite,
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
  /** Where the problem is, when the server could point at it. */
  readonly line: number | undefined

  constructor(code: ApiErrorCode, status: number, message?: string, line?: number) {
    super(message ?? code)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.serverMessage = message
    this.line = line
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

  /** The site's name and logo, for the screen shown before anybody signs in. */
  readBranding(): Promise<BrandingResponse>

  getSite(): Promise<SiteResponse>
  saveSite(site: SiteWrite): Promise<SiteResponse>

  /** The deployment's licence state. Read-only: a licence is issued elsewhere. */
  getLicense(): Promise<LicenseResponse>

  /** The dashboard: counts, the drafts worth looking at, and the last publish. */
  getOverview(): Promise<OverviewResponse>

  listPosts(query?: ContentQuery): Promise<PostListResponse>
  getPost(id: string): Promise<PostResponse>
  createPost(post: PostWrite): Promise<PostResponse>
  savePost(id: string, post: PostWrite): Promise<PostResponse>
  deletePost(id: string): Promise<void>
  setPostStatus(id: string, status: ContentStatus): Promise<PostResponse>
  bulkPosts(ids: string[], action: BulkAction): Promise<BulkResult>

  listPages(query?: ContentQuery): Promise<PageListResponse>
  getPage(id: string): Promise<PageResponse>
  createPage(page: PageWrite): Promise<PageResponse>
  savePage(id: string, page: PageWrite): Promise<PageResponse>
  deletePage(id: string): Promise<void>
  setPageStatus(id: string, status: ContentStatus): Promise<PageResponse>
  setPageHome(id: string): Promise<PageResponse>
  bulkPages(ids: string[], action: BulkAction): Promise<BulkResult>

  listProducts(query?: ContentQuery): Promise<ProductListResponse>
  getProduct(id: string): Promise<ProductResponse>
  createProduct(product: ProductWrite): Promise<ProductResponse>
  saveProduct(id: string, product: ProductWrite): Promise<ProductResponse>
  deleteProduct(id: string): Promise<void>
  setProductStatus(id: string, status: ContentStatus): Promise<ProductResponse>
  bulkProducts(ids: string[], action: BulkAction): Promise<BulkResult>

  listMedia(query?: MediaQuery): Promise<MediaListResponse>
  uploadMedia(
    file: File,
    details: { filename?: string; alt?: string; width?: number; height?: number },
  ): Promise<MediaItem>
  mediaUsages(id: string): Promise<MediaUsage>
  /** Edits the alt text of a stored item. The bytes are not editable here. */
  updateMedia(id: string, metadata: MediaMetadata): Promise<MediaItem>
  deleteMedia(id: string): Promise<void>
  /** Where the admin serves an item's bytes from. */
  mediaContentUrl(id: string): string

  /** Every theme the deployment can serve, and the one the site is using. */
  listThemes(): Promise<ThemeListResponse>
  /** One of the two documents the theme page offers to read before saving one. */
  readThemeDocument(document: 'syntax' | 'prompt'): Promise<string>
  /** Adds a theme: a name and the files read out of a folder. */
  uploadTheme(theme: ThemeUpload): Promise<ThemeListResponse>
  deleteTheme(name: string): Promise<void>

  listThemeTemplates(): Promise<ThemeTemplateListResponse>
  /** What a template may read and use, derived from a real render context. */
  getThemeContext(template: string): Promise<ThemeContextResponse>
  getThemeTemplate(path: string): Promise<ThemeTemplateResponse>
  saveThemeTemplate(path: string, source: string): Promise<ThemeTemplateResponse>
  previewThemeTemplate(path: string, source: string): Promise<ThemePreviewResponse>
  /** Drops the override, putting the bundled template back. */
  resetThemeTemplate(path: string): Promise<void>

  /** The whole taxonomy -- every vocabulary and every term -- in one request. */
  readTaxonomy(): Promise<TaxonomyResponse>
  createVocabulary(vocabulary: VocabularyWrite): Promise<Vocabulary>
  saveVocabulary(id: string, vocabulary: VocabularyWrite): Promise<Vocabulary>
  deleteVocabulary(id: string): Promise<void>
  createTerm(term: TermWrite): Promise<Term>
  saveTerm(id: string, term: TermWrite): Promise<Term>
  deleteTerm(id: string): Promise<void>
}

/** The filters the media grid can ask for. */
export interface MediaQuery {
  search?: string
  limit?: number
  offset?: number
}

/** The filters the content lists can ask for. */
export interface ContentQuery {
  status?: ContentStatus
  /** Matched against the resource's own text columns. */
  search?: string
  /** Which column to order by. Unknown keys fall back to the natural order. */
  sort?: ContentSort
  direction?: SortDirection
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

  /** Sends a request and turns a non-2xx response into something throwable. */
  async function request(method: string, path: string, init: RequestInit = {}): Promise<Response> {
    const response = await doFetch(`${baseUrl}${path}`, {
      method,
      // The default, but this is the reason the __Host- session cookie travels,
      // so it is worth stating rather than relying on a default.
      credentials: 'same-origin',
      ...init,
    })

    if (response.ok) return response

    const error = await toApiError(response)
    // The session is gone; holding on to its token would only produce 403s.
    if (error.code === 'unauthorized') csrfToken = undefined
    throw error
  }

  async function send(method: string, path: string, body?: unknown): Promise<Response> {
    const headers = new Headers()
    if (body !== undefined) headers.set('content-type', 'application/json')

    // Only writes carry the token: a read has nothing to forge, and putting it
    // on every request only widens where it can be logged.
    if (!SAFE_METHODS.has(method) && csrfToken !== undefined) headers.set(CSRF_HEADER, csrfToken)

    return request(method, path, {
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  }

  async function toApiError(response: Response): Promise<ApiError> {
    try {
      const parsed = apiErrorBodySchema.safeParse(await response.json())
      if (parsed.success) {
        return new ApiError(parsed.data.error, response.status, parsed.data.message, parsed.data.line)
      }
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

    async readBranding() {
      // Not under the admin API: this is the one thing the sign-in screen needs, and
      // it is asked for before there is a session to send.
      const response = await doFetch('/api/branding', { credentials: 'same-origin' })

      if (!response.ok) throw await toApiError(response)

      return readContract(
        brandingResponseSchema,
        response,
        'the branding did not match the contract',
      )
    },

    async getSite() {
      return readContract(siteResponseSchema, await send('GET', '/site'), 'the site response did not match the contract')
    },

    async getOverview() {
      return readContract(
        overviewResponseSchema,
        await send('GET', '/overview'),
        'the overview did not match the contract',
      )
    },

    async getLicense() {
      return readContract(
        licenseResponseSchema,
        await send('GET', '/license'),
        'the license response did not match the contract',
      )
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

    async listPages(query = {}) {
      return readContract(
        getPageListResponseSchema(),
        await send('GET', `/pages${toQueryString(query)}`),
        'the page list did not match the contract',
      )
    },

    async getPage(id) {
      return readContract(
        getPageResponseSchema(),
        await send('GET', `/pages/${encodeURIComponent(id)}`),
        'the page did not match the contract',
      )
    },

    async createPage(page) {
      return readContract(
        getPageResponseSchema(),
        await send('POST', '/pages', page),
        'the save response did not match the contract',
      )
    },

    async savePage(id, page) {
      return readContract(
        getPageResponseSchema(),
        await send('PUT', `/pages/${encodeURIComponent(id)}`, page),
        'the save response did not match the contract',
      )
    },

    async deletePage(id) {
      await send('DELETE', `/pages/${encodeURIComponent(id)}`)
    },

    async setPageStatus(id, status) {
      return readContract(
        getPageResponseSchema(),
        await send('POST', `/pages/${encodeURIComponent(id)}/status`, { status }),
        'the status response did not match the contract',
      )
    },

    async setPageHome(id) {
      return readContract(
        getPageResponseSchema(),
        await send('POST', `/pages/${encodeURIComponent(id)}/home`),
        'the home response did not match the contract',
      )
    },

    async listProducts(query = {}) {
      return readContract(
        getProductListResponseSchema(),
        await send('GET', `/products${toQueryString(query)}`),
        'the product list did not match the contract',
      )
    },

    async getProduct(id) {
      return readContract(
        getProductResponseSchema(),
        await send('GET', `/products/${encodeURIComponent(id)}`),
        'the product did not match the contract',
      )
    },

    async createProduct(product) {
      return readContract(
        getProductResponseSchema(),
        await send('POST', '/products', product),
        'the save response did not match the contract',
      )
    },

    async saveProduct(id, product) {
      return readContract(
        getProductResponseSchema(),
        await send('PUT', `/products/${encodeURIComponent(id)}`, product),
        'the save response did not match the contract',
      )
    },

    async deleteProduct(id) {
      await send('DELETE', `/products/${encodeURIComponent(id)}`)
    },

    async setProductStatus(id, status) {
      return readContract(
        getProductResponseSchema(),
        await send('POST', `/products/${encodeURIComponent(id)}/status`, { status }),
        'the status response did not match the contract',
      )
    },

    async bulkPosts(ids, action) {
      return readContract(
        bulkResultSchema,
        await send('POST', '/posts/bulk', { ids, action }),
        'the bulk response did not match the contract',
      )
    },

    async bulkPages(ids, action) {
      return readContract(
        bulkResultSchema,
        await send('POST', '/pages/bulk', { ids, action }),
        'the bulk response did not match the contract',
      )
    },

    async bulkProducts(ids, action) {
      return readContract(
        bulkResultSchema,
        await send('POST', '/products/bulk', { ids, action }),
        'the bulk response did not match the contract',
      )
    },

    async listMedia(query = {}) {
      const params = new URLSearchParams()
      if (query.search !== undefined && query.search.trim() !== '') params.set('search', query.search.trim())
      if (query.limit !== undefined) params.set('limit', String(query.limit))
      if (query.offset !== undefined && query.offset > 0) params.set('offset', String(query.offset))
      const encoded = params.toString()

      return readContract(
        mediaListResponseSchema,
        await send('GET', `/media${encoded === '' ? '' : `?${encoded}`}`),
        'the media list did not match the contract',
      )
    },

    async uploadMedia(file, details) {
      // The chosen name, or the file's own when the operator left the field blank:
      // an empty filename in the library is worse than the one the camera wrote.
      const query = new URLSearchParams({ filename: details.filename?.trim() || file.name })
      if (details.alt !== undefined && details.alt !== '') query.set('alt', details.alt)
      if (details.width !== undefined) query.set('width', String(details.width))
      if (details.height !== undefined) query.set('height', String(details.height))

      const headers = new Headers()
      // The file's own type, because that is what the Worker checks before it
      // stores anything. A file the browser could not identify is sent as opaque
      // bytes so it is refused there rather than silently mislabelled here.
      headers.set('content-type', file.type === '' ? 'application/octet-stream' : file.type)
      if (csrfToken !== undefined) headers.set(CSRF_HEADER, csrfToken)

      return readContract(
        mediaItemSchema,
        await request('POST', `/media?${query.toString()}`, { headers, body: file }),
        'the upload response did not match the contract',
      )
    },

    async mediaUsages(id) {
      return readContract(
        mediaUsageSchema,
        await send('GET', `/media/${encodeURIComponent(id)}/usages`),
        'the usage response did not match the contract',
      )
    },

    async updateMedia(id, metadata) {
      return readContract(
        mediaItemSchema,
        await send('PATCH', `/media/${encodeURIComponent(id)}`, metadata),
        'the media response did not match the contract',
      )
    },

    async deleteMedia(id) {
      await send('DELETE', `/media/${encodeURIComponent(id)}`)
    },

    mediaContentUrl(id) {
      return `${baseUrl}/media/${encodeURIComponent(id)}/content`
    },

    async listThemes() {
      return readContract(
        themeListResponseSchema,
        await send('GET', '/theme/themes'),
        'the theme list did not match the contract',
      )
    },

    async readThemeDocument(document) {
      // Read as text, not through the contract helpers: this is a document rather than
      // a JSON response, and the server offers it as a download either way -- the
      // `Content-Disposition` header is the browser's business, not this one's.
      const response = await doFetch(`${baseUrl}/theme/${document}`, {
        credentials: 'same-origin',
      })

      if (!response.ok) throw await toApiError(response)

      return response.text()
    },

    async uploadTheme(theme) {
      return readContract(
        themeListResponseSchema,
        await send('POST', '/theme/themes', theme),
        'the theme list did not match the contract',
      )
    },

    async deleteTheme(name) {
      await send('DELETE', `/theme/themes?name=${encodeURIComponent(name)}`)
    },

    async listThemeTemplates() {
      return readContract(
        themeTemplateListResponseSchema,
        await send('GET', '/theme/templates'),
        'the template list did not match the contract',
      )
    },

    async getThemeContext(template) {
      return readContract(
        themeContextResponseSchema,
        // A query parameter, like the template read: a template name has a slash.
        await send('GET', `/theme/context?template=${encodeURIComponent(template)}`),
        'the context reference did not match the contract',
      )
    },

    async getThemeTemplate(path) {
      return readContract(
        themeTemplateResponseSchema,
        // A query parameter: a template name contains a slash, and putting one
        // into a path is how traversal bugs start.
        await send('GET', `/theme/template?path=${encodeURIComponent(path)}`),
        'the template did not match the contract',
      )
    },

    async saveThemeTemplate(path, source) {
      return readContract(
        themeTemplateResponseSchema,
        await send('PUT', '/theme/template', { path, source }),
        'the save response did not match the contract',
      )
    },

    async previewThemeTemplate(path, source) {
      return readContract(
        themePreviewResponseSchema,
        await send('POST', '/theme/preview', { path, source }),
        'the preview response did not match the contract',
      )
    },

    async resetThemeTemplate(path) {
      // A query parameter, like the read: the name contains a slash.
      await send('DELETE', `/theme/template?path=${encodeURIComponent(path)}`)
    },

    async readTaxonomy() {
      return readContract(
        taxonomyResponseSchema,
        await send('GET', '/taxonomy'),
        'the taxonomy did not match the contract',
      )
    },

    async createVocabulary(vocabulary) {
      return readContract(
        vocabularySchema,
        await send('POST', '/taxonomy/vocabularies', vocabulary),
        'the vocabulary did not match the contract',
      )
    },

    async saveVocabulary(id, vocabulary) {
      return readContract(
        vocabularySchema,
        await send('PUT', `/taxonomy/vocabularies/${encodeURIComponent(id)}`, vocabulary),
        'the vocabulary did not match the contract',
      )
    },

    async deleteVocabulary(id) {
      await send('DELETE', `/taxonomy/vocabularies/${encodeURIComponent(id)}`)
    },

    async createTerm(term) {
      return readContract(
        termSchema,
        await send('POST', '/taxonomy/terms', term),
        'the term did not match the contract',
      )
    },

    async saveTerm(id, term) {
      return readContract(
        termSchema,
        await send('PUT', `/taxonomy/terms/${encodeURIComponent(id)}`, term),
        'the term did not match the contract',
      )
    },

    async deleteTerm(id) {
      await send('DELETE', `/taxonomy/terms/${encodeURIComponent(id)}`)
    },
  }

  return client
}

/**
 * Only the filters that were set reach the URL, so a request without a search
 * term cannot be answered from a different cache entry than a request for
 * everything.
 */
function toQueryString(query: ContentQuery): string {
  const params = new URLSearchParams()

  if (query.status !== undefined) params.set('status', query.status)
  if (query.search !== undefined && query.search.trim() !== '') params.set('search', query.search.trim())
  if (query.sort !== undefined) params.set('sort', query.sort)
  if (query.direction !== undefined) params.set('direction', query.direction)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined && query.offset > 0) params.set('offset', String(query.offset))

  const encoded = params.toString()
  return encoded === '' ? '' : `?${encoded}`
}
