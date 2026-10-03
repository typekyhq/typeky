import { CSRF_HEADER, loginRequestSchema } from '@typeky/api'
import { Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import type { MiddlewareHandler } from 'hono'
import { repositoriesFor } from '../repositories'
import { blobsFor } from '../blobs'
import { edgeCacheFor, revalidateSite } from '../cache'
import { csrfTokenMatches, isSafeMethod } from './csrf'
import { apiError, readJsonBody, type AdminEnv, type BlobResolver, type RepositoryResolver } from './errors'
import {
  deleteMedia,
  readMedia,
  readMediaContent,
  readMediaUsages,
  uploadMedia,
} from './media'
import {
  createPage,
  bulkPages,
  deletePage,
  readPage,
  readPages,
  setPageHome,
  setPageStatus,
  updatePage,
} from './pages'
import { verifyPassword } from './password'
import {
  readThemeContext,
  readThemeTemplate,
  readThemeTemplates,
  previewThemeTemplate,
  resetThemeTemplate,
  writeThemeTemplate,
} from './theme'
import {
  bulkPosts,
  createPost,
  deletePost,
  readPost,
  readPosts,
  setPostStatus,
  updatePost,
} from './posts'
import {
  bulkProducts,
  createProduct,
  deleteProduct,
  readProduct,
  readProducts,
  setProductStatus,
  updateProduct,
} from './products'
import {
  SESSION_COOKIE,
  SESSION_COOKIE_OPTIONS,
  SESSION_TTL_SECONDS,
  createSession,
  destroySession,
  readSession,
} from './session'
import { readLicense } from './license'
import { readSite, writeSite } from './site'
import {
  createTerm,
  createVocabulary,
  deleteTerm,
  deleteVocabulary,
  readTaxonomy,
  updateTerm,
  updateVocabulary,
} from './taxonomy'

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

export interface AdminApiOptions {
  /**
   * Resolves the data layer for a request. Defaults to the D1 repositories; a
   * test can supply its own instead of arranging a database binding.
   */
  repositories?: RepositoryResolver
  /** Resolves blob storage. Defaults to R2; a test supplies an in-memory one. */
  blobs?: BlobResolver
}

const DEFAULT_ACTOR_ID = 'admin'

export function createAdminApi(options: AdminApiOptions = {}): Hono<AdminEnv> {
  const repositories = options.repositories ?? repositoriesFor
  const blobs = options.blobs ?? blobsFor
  const api = new Hono<AdminEnv>()

  /**
   * A successful write forgets the pages it changed.
   *
   * Registered first, so it wraps everything below -- including the guard
   * middleware, whose early return leaves the status at 401 or 403 and is
   * therefore skipped by the status check. Order matters for the opposite reason
   * too: a middleware registered *after* a route never runs for it, because the
   * route has already answered.
   *
   * The purge is awaited rather than handed to `waitUntil`. It costs the operator
   * a handful of milliseconds once per save, and it buys the property that matters
   * more: by the time the save has been acknowledged, the next request for the
   * page cannot be served the old one. A background purge would make "publish,
   * then look" a race, and losing that race looks exactly like the bug this
   * exists to prevent.
   */
  api.use('*', async (c, next) => {
    await next()

    if (isSafeMethod(c.req.method)) return
    if (c.res.status >= 400) return

    // Two exceptions, and neither stores anything a visitor can be served: a
    // session is a cookie, and a preview is rendered and thrown away.
    const path = new URL(c.req.url).pathname
    if (path.endsWith('/session') || path.endsWith('/theme/preview')) return

    const store = repositories(c.env)
    if (store === null) return

    await revalidateSite(store, edgeCacheFor(), new URL(c.req.url).origin, c.env.APP_ENV)
  })

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

    const parsed = loginRequestSchema.safeParse(await readJsonBody(c.req.raw))
    if (!parsed.success) return apiError(c, 'invalid_request', 'expected a username and a password')

    // Verified even when the username is wrong, so response time does not reveal
    // whether the username was right.
    const passwordMatches = await verifyPassword(parsed.data.password, hash)
    const usernameMatches = parsed.data.username === (c.env.ADMIN_USERNAME ?? DEFAULT_ACTOR_ID)
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

  api.get('/license', (c) => readLicense(c))

  api.get('/site', (c) => readSite(c, repositories))
  api.put('/site', (c) => writeSite(c, repositories))

  // Posts. `POST /posts` and `PUT /posts/:id` differ only in whether an id comes
  // from the path, which is what makes "save" the same operation whether the
  // editor is creating or replacing.
  api.get('/posts', (c) => readPosts(c, repositories))
  api.post('/posts', (c) => createPost(c, repositories))
  // Before `/:id`, or the id route would capture "bulk" as an id.
  api.post('/posts/bulk', (c) => bulkPosts(c, repositories))
  api.get('/posts/:id', (c) => readPost(c, repositories))
  api.put('/posts/:id', (c) => updatePost(c, repositories))
  api.delete('/posts/:id', (c) => deletePost(c, repositories))
  // Its own endpoint so the list can publish without the whole document and
  // without a second round trip to fetch it.
  api.post('/posts/:id/status', (c) => setPostStatus(c, repositories))

  // Pages, the same shape, plus the one flag the database allows only once.
  api.get('/pages', (c) => readPages(c, repositories))
  api.post('/pages', (c) => createPage(c, repositories))
  api.post('/pages/bulk', (c) => bulkPages(c, repositories))
  api.get('/pages/:id', (c) => readPage(c, repositories))
  api.put('/pages/:id', (c) => updatePage(c, repositories))
  api.delete('/pages/:id', (c) => deletePage(c, repositories))
  api.post('/pages/:id/status', (c) => setPageStatus(c, repositories))
  // Not a field on the write: changing the home page is a move between rows,
  // and putting it in a whole-document write would make the outcome depend on
  // the order two saves happened to arrive in.
  api.post('/pages/:id/home', (c) => setPageHome(c, repositories))

  // Products, the same shape again.
  api.get('/products', (c) => readProducts(c, repositories))
  api.post('/products', (c) => createProduct(c, repositories))
  api.post('/products/bulk', (c) => bulkProducts(c, repositories))
  api.get('/products/:id', (c) => readProduct(c, repositories))
  api.put('/products/:id', (c) => updateProduct(c, repositories))
  api.delete('/products/:id', (c) => deleteProduct(c, repositories))
  api.post('/products/:id/status', (c) => setProductStatus(c, repositories))

  // Media. The upload is a POST whose body is the file and whose content type is
  // the file's own; everything else about it is a query parameter.
  api.get('/media', (c) => readMedia(c, repositories))
  api.post('/media', (c) => uploadMedia(c, repositories, blobs))
  api.get('/media/:id/content', (c) => readMediaContent(c, repositories, blobs))
  api.get('/media/:id/usages', (c) => readMediaUsages(c, repositories))
  api.delete('/media/:id', (c) => deleteMedia(c, repositories, blobs))

  // The taxonomy: vocabularies and their terms. One read for the whole screen,
  // because vocabularies and terms are two halves of one list; the writes are per
  // resource, because the screen changes one thing at a time.
  api.get('/taxonomy', (c) => readTaxonomy(c, repositories))
  api.post('/taxonomy/vocabularies', (c) => createVocabulary(c, repositories))
  api.put('/taxonomy/vocabularies/:id', (c) => updateVocabulary(c, repositories))
  api.delete('/taxonomy/vocabularies/:id', (c) => deleteVocabulary(c, repositories))
  api.post('/taxonomy/terms', (c) => createTerm(c, repositories))
  api.put('/taxonomy/terms/:id', (c) => updateTerm(c, repositories))
  api.delete('/taxonomy/terms/:id', (c) => deleteTerm(c, repositories))

  // The theme's templates. Read-only for now, and deliberately without a way to
  // create one: a site may edit what its theme ships and nothing more.
  api.get('/theme/templates', (c) => readThemeTemplates(c, repositories))
  api.get('/theme/template', (c) => readThemeTemplate(c, repositories))
  // What a template may read, derived from a real context rather than written down.
  api.get('/theme/context', (c) => readThemeContext(c, repositories))
  api.put('/theme/template', (c) => writeThemeTemplate(c, repositories))
  // Restoring the bundled template: the override row goes, the baseline shows.
  api.delete('/theme/template', (c) => resetThemeTemplate(c, repositories))
  // The same checks as a save, then a render with sample data. Nothing stored.
  api.post('/theme/preview', (c) => previewThemeTemplate(c, repositories))

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
