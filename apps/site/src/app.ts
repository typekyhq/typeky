import { firstPathSegment } from '@typeky/api'
import { defaultContext } from '@typeky/db'
import { createD1DbPort } from '@typeky/platform'
import type { ApiErrorBody, BrandingResponse } from '@typeky/api'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { createAdminApi } from './admin/api'
import { readSession, SESSION_COOKIE } from './admin/session'
import { ADMIN_BUILD_SEGMENT, adminPathFor } from './admin-config'
import { blobsFor } from './blobs'
import { edgeCacheFor, servePage } from './cache'
import type { Env } from './env'
import { licenseState } from './license'
import { serveMedia } from './media'
import { errorPage, notFoundPage } from './pages'
import { renderPage } from './render/page'
import { robotsRules } from './render/seo-settings'
import { renderRobots, renderSitemap } from './render/sitemap'
import { repositoriesFor } from './repositories'
import { serveThemeAsset, serveUploadedThemeAsset, themeAssetNotFound } from './theme-assets'
import { themeAssetSource } from './themes'

/**
 * The site Worker.
 *
 * Request layering follows architecture section 2.1: static assets are served by
 * Cloudflare without invoking this Worker at all (the `run_worker_first` list in
 * `wrangler.jsonc` is what decides), so reaching a handler here already means no
 * asset matched. That is why the admin fallback below simply serves the shell,
 * and why a path that looks like a file gets a plain 404 instead of a page --
 * a missing image should not return HTML.
 *
 * Built as a factory so tests can construct an app without bindings.
 */
export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>()

  app.get('/healthz', async (c) => {
    const database = await probeDatabase(c.env)

    return c.json(
      { status: database === 'error' ? 'degraded' : 'ok', env: c.env.APP_ENV, database },
      database === 'error' ? 503 : 200,
    )
  })

  // The admin JSON API. Registered before the public catch-all so the more
  // specific prefix wins.
  app.route('/api/admin', createAdminApi())

  // The sign-in screen's branding, and the only public endpoint under /api.
  //
  // Public because the panel cannot read the site document until somebody is signed
  // in, and because there is nothing here a visitor could not already see on the
  // site itself: its name, and its logo.
  app.get('/api/branding', async (c) => {
    const store = repositoriesFor(c.env)
    const site = store === null ? null : await store.sites.get(defaultContext()).catch(() => null)
    const body: BrandingResponse = {
      name: site?.name ?? 'Typeky',
      logoUrl:
        site?.logoMediaId == null
          ? null
          : `${new URL(c.req.url).origin}/media/${encodeURIComponent(site.logoMediaId)}`,
    }

    return c.json(body)
  })

  // Public read-only API. Lands with the site rendering work.
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

  /**
   * Where the panel is, decided before anything else looks at the path.
   *
   * A fixed `/admin` is the first thing a scanner tries, and the operator can move
   * it -- so the segment is a setting rather than a route, and this middleware is
   * what owns it. `admin-config.ts` explains why it has to be a middleware at all,
   * and what the cache in front of the answer costs.
   */
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url)
    const segment = firstPathSegment(url.pathname)
    if (segment === '') return next()

    const adminPath = await adminPathFor(c.env)

    if (segment === adminPath) {
      // The panel's own files, wherever the entry point is called: the build writes
      // them under `ADMIN_BUILD_SEGMENT/assets/`, and only the way in is a secret.
      // Checked by the asset prefix rather than by `ADMIN_BUILD_SEGMENT` alone --
      // everything else under the entry point is a client-side route.
      if (url.pathname.startsWith(`/${ADMIN_BUILD_SEGMENT}/assets/`)) {
        return serveAdminAsset(c.env, url.pathname, c.req.raw)
      }

      // Anything else under the entry point is a client-side route, and the shell is
      // what answers it. The shell itself is never cached (see public/_headers),
      // while the hashed assets next to it are.
      return serveAdminShell(c.env, c.req.raw)
    }

    if (segment !== ADMIN_BUILD_SEGMENT) return next()

    if (url.pathname.startsWith(`/${ADMIN_BUILD_SEGMENT}/assets/`)) {
      return serveAdminAsset(c.env, url.pathname, c.req.raw)
    }

    // The address the panel is *not* at. A scanner that knows the build directory
    // gets a plain 404 rather than a sign-in screen -- and a browser holding the old
    // address is sent to the new one, but only while it is already signed in, so the
    // redirect never announces where the panel moved to. That is the way back in for
    // an operator who has just changed the setting and cannot remember the value.
    const moved = await panelMovedTo(c, adminPath)
    if (moved !== null) return c.redirect(moved, 302)

    return notFound(c)
  })

  // Media, served to visitors. Registered before the catch-all because a media
  // URL has no file extension and would otherwise be treated as a page.
  app.get('/media/:id', (c) => serveMedia(c.env, c.req.param('id'), c.req.raw))

  // The theme's own files. Before the catch-all for the same reason as media,
  // and before `looksLikeAsset` can see them: `.css` and `.js` are exactly the
  // extensions that rule was written for, so a stylesheet would otherwise be
  // answered with a plain 404 and the page would render unstyled.
  app.get('/theme/:name', async (c) => {
    const name = c.req.param('name')
    const store = repositoriesFor(c.env)
    const site = store === null ? null : await store.sites.get(defaultContext()).catch(() => null)
    const theme = site?.theme ?? 'default'

    // The bundled theme's files are in the bundle; an uploaded theme's are rows, and
    // a theme that does not ship the file answers 404 rather than falling back to
    // another theme's -- a page styled by a theme it is not using is the kind of
    // wrong that looks like a caching problem.
    if (theme === 'default') return serveThemeAsset(name, c.req.raw)

    const source = store === null ? null : await themeAssetSource(store, theme, name)

    return source === null ? themeAssetNotFound() : serveUploadedThemeAsset(name, source)
  })

  // `robots.txt` and `sitemap.xml` before the catch-all too: both have a file
  // extension, so the catch-all would answer them with a plain 404 and a crawler
  // would take that for an answer.
  app.get('/robots.txt', async (c) => {
    // Read for the robots settings alone. A database that cannot be reached is not
    // a reason to hand a crawler an error page: the platform's own rules stand on
    // their own, and the answer that keeps them in force is the one without the
    // operator's extras.
    const store = repositoriesFor(c.env)
    const site = store === null ? null : await store.sites.get(defaultContext()).catch(() => null)
    const rules = site === null ? { noindex: false, disallowPaths: [] } : robotsRules(site.settings)

    return c.body(renderRobots(new URL(c.req.url).origin, rules), 200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    })
  })

  app.get('/sitemap.xml', async (c) => {
    const store = repositoriesFor(c.env)
    if (store === null) return c.text('Not Found', 404)

    return c.body(await renderSitemap(store, new URL(c.req.url).origin), 200, {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    })
  })

  app.get('*', async (c) => {
    const url = new URL(c.req.url)

    // A path that looks like a file is not a page, so it gets a plain 404 rather
    // than HTML. `no-store`, because a browser that caches this answer keeps
    // asking for a file that a later deploy may well have added.
    if (looksLikeAsset(url.pathname)) {
      return c.body('Not Found', 404, {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
      })
    }

    // Resolved per request, because the answer is part of what the page says: a
    // licensed site and a free one render different HTML.
    //
    // Note what this does *not* do: it cannot change a page that is already in the
    // edge cache, because the cache key is the URL and the licence is not part of
    // it. Buying a licence therefore takes effect within `s-maxage` rather than at
    // the instant the secret is set -- five minutes, or immediately after the next
    // publish, which purges. Putting the licence in the key would make that
    // instantaneous and would also mean every cached URL had to be remembered with
    // the licence state it was stored under, which is a worse trade for a switch
    // that is thrown once.
    const license = await licenseState(c.env, url.host)

    // The cache answers first, so a hit costs no database query at all. That is
    // the whole reason it exists; a cache that still had to look something up to
    // decide what to serve would not be worth the complexity.
    return servePage({
      url,
      cache: edgeCacheFor(),
      appEnv: c.env.APP_ENV,
      render: (pathname) =>
        renderPage(pathname, {
          repositories: repositoriesFor(c.env),
          db: c.env.DB === undefined ? null : createD1DbPort(c.env.DB),
          blob: blobsFor(c.env),
          // The origin the request arrived on, so a canonical URL points at the
          // site that was actually asked for rather than at a configured one.
          baseUrl: url.origin,
          whiteLabel: license.whiteLabel,
        }),
      // In the background: the response should not wait for a cache write.
      background: (task) => c.executionCtx.waitUntil(task),
    })
  })

  app.notFound((c) => c.html(notFoundPage(new URL(c.req.url).pathname), 404))

  app.onError((error, c) => {
    console.error('unhandled site error', error)

    // The API always answers JSON; an HTML error page would leave the admin SPA
    // parsing markup and reporting the wrong thing.
    if (new URL(c.req.url).pathname.startsWith('/api/')) {
      return c.json({ error: 'internal_error' } satisfies ApiErrorBody, 500)
    }

    return c.html(errorPage(), 500)
  })

  return app
}

const ASSET_EXTENSION = /\.[a-z0-9]+$/i

function looksLikeAsset(path: string): boolean {
  return ASSET_EXTENSION.test(path)
}


/**
 * A single light query, and no caching layer in front of it: the 60 second KV
 * cache in architecture section 10.1 exists to protect Hyperdrive, which CE does
 * not use.
 */
async function probeDatabase(env: Env): Promise<'ok' | 'unbound' | 'error'> {
  if (env.DB === undefined) return 'unbound'

  try {
    await createD1DbPort(env.DB).first('SELECT 1 AS ok')
    return 'ok'
  } catch (error) {
    console.error('healthz database probe failed', error)
    return 'error'
  }
}

/**
 * The panel's own files, fetched from the build directory.
 *
 * The entry point is a setting, so these cannot be served by the asset layer: the
 * Worker owns them and hands them back from the binding. The path is used as given,
 * because it is the build's own (`/admin/assets/<hash>.js`) rather than anything the
 * request chose to put in front of it.
 */
async function serveAdminAsset(env: Env, pathname: string, request: Request): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL(pathname, request.url), { method: 'GET' }))
}

/**
 * Where a signed-in request should go now that the panel has moved, or null.
 *
 * The prefix is swapped rather than the request being rewritten, so the browser ends
 * up on the address the panel really lives at -- which is the address its own links
 * use, and therefore the one that has to work.
 */
async function panelMovedTo(c: Context<{ Bindings: Env }>, adminPath: string): Promise<string | null> {
  const session = await readSession(c.env.CACHE, getCookie(c, SESSION_COOKIE))
  if (session === null) return null

  const url = new URL(c.req.url)
  const rest = url.pathname.slice(ADMIN_BUILD_SEGMENT.length + 1)

  return `/${adminPath}${rest}${url.search}`
}

/** A missing file, said in as few words as the asset layer would use. */
function notFound(c: Context): Response {
  return c.body('Not Found', 404, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
  })
}

async function serveAdminShell(env: Env, request: Request): Promise<Response> {
  const shell = await env.ASSETS.fetch(new Request(new URL('/admin/index.html', request.url)))
  if (!shell.ok) return new Response(notFoundPage(new URL(request.url).pathname), {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })

  return new Response(shell.body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // The shell references hashed assets, so it must be revalidated on every
      // deploy or the previous asset map keeps being served.
      'cache-control': 'no-cache',
    },
  })
}
