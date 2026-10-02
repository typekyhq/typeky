import { createD1DbPort } from '@typeky/platform'
import type { ApiErrorBody } from '@typeky/api'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { createAdminApi } from './admin/api'
import { blobsFor } from './blobs'
import type { Env } from './env'
import { serveMedia } from './media'
import { errorPage, notFoundPage } from './pages'
import { renderPage } from './render/page'
import { repositoriesFor } from './repositories'

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

  // Public read-only API. Lands with the site rendering work.
  app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

  // Admin SPA: static assets win first, so anything reaching here is a
  // client-side route and must be answered with the shell. The shell itself is
  // never cached (see public/_headers), while the hashed assets next to it are.
  app.get('/admin/*', (c) => serveAdminShell(c.env, c.req.raw))
  app.get('/admin', (c) => serveAdminShell(c.env, c.req.raw))

  // Media, served to visitors. Registered before the catch-all because a media
  // URL has no file extension and would otherwise be treated as a page.
  app.get('/media/:id', (c) => serveMedia(c.env, c.req.param('id'), c.req.raw))

  app.get('*', async (c) => {
    const path = new URL(c.req.url).pathname
    if (looksLikeAsset(path)) return c.text('Not Found', 404)

    const result = await renderPage(path, {
      repositories: repositoriesFor(c.env),
      db: c.env.DB === undefined ? null : createD1DbPort(c.env.DB),
      blob: blobsFor(c.env),
      // The origin the request arrived on, so a canonical URL points at the site
      // that was actually asked for rather than at a configured one.
      baseUrl: new URL(c.req.url).origin,
    })

    return c.html(result.html, result.status as ContentfulStatusCode)
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
