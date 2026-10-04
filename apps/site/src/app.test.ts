import { PLATFORM_PATHS, firstPathSegment } from '@typeky/api'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import type { Env } from './env'
import { escapeHtml } from './pages'
import { fakeAssets, fakeDatabase, makeTestEnv } from './testing/env'
import { SESSION_COOKIE, createSession } from './admin/session'
import { fakeKv } from './testing/env'

/** Hono puts the bindings in the third argument, after RequestInit. */
async function send(path: string, env: Env = makeTestEnv(), init?: RequestInit): Promise<Response> {
  // `request` is typed as returning a Response or a promise of one.
  return createApp().request(new Request(`https://example.com${path}`, init), undefined, env)
}

/** Errors are logged before the 500 page is returned; keep test output readable. */
function silenceErrors(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

/**
 * The reserved list against the routes that actually exist.
 *
 * The list is what the admin shows as "reserved by the platform", and what makes a
 * page slug refused. A route that is not in it is a path a page can take -- so this
 * is the assertion that keeps the two from drifting, and the direction it catches is
 * the quiet one.
 */
describe('the reserved paths', () => {
  it('names every path the Worker answers', () => {
    const routes = createApp().routes
    // The catch-all is the page renderer itself: a page is what it serves, not a path
    // the platform claims.
    const claimed = routes
      .map((route) => route.path)
      // The catch-all is spelled `/*`, and either spelling is the renderer itself.
      .filter((path) => firstPathSegment(path) !== '*')
      .map((path) => `/${firstPathSegment(path)}`)

    const missing = [...new Set(claimed)].filter((path) => !PLATFORM_PATHS.includes(path))

    expect(missing).toEqual([])
  })

  it('also names the asset branches, which the Worker never sees', () => {
    // `public/` is served by the asset layer before this Worker runs, so these are not
    // in the route table -- and a page at `/static` would still be fighting it.
    expect(PLATFORM_PATHS).toContain('/static')
  })

  it('never lists the front page, which is the site\u2019s own', () => {
    // `/` belongs to the operator, served by whichever page they marked as home.
    // Listing it as reserved would read as "you may not have a home page".
    expect(PLATFORM_PATHS).not.toContain('/')
  })
})

describe('site worker', () => {
  describe('healthz', () => {
    it('reports ok when no database is bound yet', async () => {
      const response = await send('/healthz')

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toEqual({
        status: 'ok',
        env: 'test',
        database: 'unbound',
      })
    })

    it('probes the database when one is bound', async () => {
      const response = await send('/healthz', makeTestEnv({ DB: fakeDatabase(async () => ({ ok: 1 })) }))

      expect(response.status).toBe(200)
      await expect(response.json()).resolves.toMatchObject({ status: 'ok', database: 'ok' })
    })

    it('reports degraded when the probe fails, rather than pretending to be healthy', async () => {
      silenceErrors()
      const database = fakeDatabase(async () => {
        throw new Error('no such table: pages')
      })

      const response = await send('/healthz', makeTestEnv({ DB: database }))

      expect(response.status).toBe(503)
      await expect(response.json()).resolves.toMatchObject({ status: 'degraded', database: 'error' })
    })
  })

  describe('api', () => {
    it('answers an unknown api path as JSON, not as a page', async () => {
      // The admin prefix has its own guard (see admin/api.test.ts); this covers
      // the public side, which stays JSON rather than falling through to a page.
      const response = await send('/api/v1/pages')

      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('application/json')
    })
  })

  describe('admin shell', () => {
    const built = { '/admin/index.html': '<!doctype html><div id="root"></div>' }

    it('serves the shell for a client-side route', async () => {
      const response = await send('/admin/settings', makeTestEnv({ ASSETS: fakeAssets(built) }))

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('id="root"')
      // Never cached: the shell points at hashed assets, so a stale copy would
      // keep loading the previous deploy's files.
      expect(response.headers.get('cache-control')).toBe('no-cache')
    })

    it('serves the shell for bare /admin too', async () => {
      const response = await send('/admin', makeTestEnv({ ASSETS: fakeAssets(built) }))

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('id="root"')
    })

    it('returns the not-found page while the admin build does not exist', async () => {
      const response = await send('/admin/settings')

      expect(response.status).toBe(404)
      expect(await response.text()).toContain('Page not found')
    })

    it('returns the error page when the assets binding itself fails', async () => {
      silenceErrors()

      const response = await send('/admin/settings', makeTestEnv({ ASSETS: fakeAssets({}, true) }))

      expect(response.status).toBe(500)
      expect(await response.text()).toContain('Something went wrong')
    })
  })

  describe('failures', () => {
    it('answers an api failure as JSON, so the admin SPA is never handed markup', async () => {
      silenceErrors()
      // A binding that throws reaches onError the same way a bug in a handler
      // would; the point is only that the API layer answers in its own format.
      const brokenCache = {
        get: async () => {
          throw new Error('kv unavailable')
        },
      } as unknown as KVNamespace

      const response = await send('/api/admin/pages', makeTestEnv({ CACHE: brokenCache }), {
        // A cookie has to be present, or the session lookup short-circuits before
        // it ever asks the binding.
        headers: { cookie: '__Host-typeky_session=whatever' },
      })

      expect(response.status).toBe(500)
      expect(response.headers.get('content-type')).toContain('application/json')
      await expect(response.json()).resolves.toEqual({ error: 'internal_error' })
    })

    it('keeps the html error page for site paths', async () => {
      silenceErrors()

      const response = await send('/about', makeTestEnv({ ASSETS: fakeAssets({}, true) }))

      // The placeholder path does not touch ASSETS, so nothing fails here: the
      // assertion is that a site path never turns into JSON.
      expect(response.headers.get('content-type')).toContain('text/html')
    })
  })

  describe('site pages', () => {
    it('answers with a setup message when there is no database', async () => {
      const response = await send('/')

      // Not a theme page: with no site row there is no theme to render one from,
      // and a page that cannot load its own assets is worse than saying so.
      expect(response.status).toBe(503)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('Almost there')
    })

    it('says the same thing for a content path as for the front page', async () => {
      const response = await send('/about')

      // Whether /about exists is a question the database answers, and there is
      // not one, so this is not a 404 either.
      expect(response.status).toBe(503)
      expect(await response.text()).toContain('no database configured')
    })

    it('does not answer a missing asset with an HTML page', async () => {
      const response = await send('/theme/logo.svg')

      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('text/plain')
    })

    it('answers the theme stylesheet before the asset rule can 404 it', async () => {
      // `/theme/theme.css` has exactly the extension `looksLikeAsset` exists to
      // reject, so the route has to be registered ahead of the catch-all. Without
      // that the page renders and loads no stylesheet at all, which is the kind
      // of failure that reads as a CSS bug.
      const response = await send('/theme/theme.css')

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/css')
    })

    it('keeps its own pages out of search results', async () => {
      const response = await send('/nope')

      expect(await response.text()).toContain('name="robots" content="noindex"')
    })
  })

  /**
 * Where the panel is.
 *
 * `/admin` is the first thing a scanner tries, so the operator can move the entry
 * point. The route table cannot know a setting, so a middleware owns the segment --
 * which makes these the tests for the whole mechanism: the configured address
 * answers, the default stops answering, the panel's own files keep working, and the
 * way back in exists for a browser that is already signed in.
 */
describe('theme assets', () => {
  /** A site row served by an uploaded theme. */
  function themeSite(theme: string): Record<string, unknown> {
    return {
      id: 'default',
      name: 'Typeky Demo',
      tagline: null,
      logo_media_id: null,
      favicon_media_id: null,
      theme,
      settings: '{}',
      nav: '[]',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
  }

  it('serves the bundled asset for a theme that does not ship one', async () => {
    // A theme is layered over the default, so a stylesheet it does not ship is the
    // bundled one: an unstyled page is not a design choice anybody made.
    const env = makeTestEnv({ DB: fakeDatabase(async () => themeSite('minimal')) })

    const response = await send('/theme/theme.css', env)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/css')
  })
})

describe('the panel address', () => {
  /** A site row, with the panel wherever the test wants it. */
  function siteRow(path: string): Record<string, unknown> {
    return {
      id: 'default',
      name: 'Typeky Demo',
      tagline: null,
      logo_media_id: null,
      favicon_media_id: null,
      theme: 'default',
      settings: JSON.stringify({ admin: { path } }),
      nav: '[]',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }
  }

  const SHELL = { '/admin/index.html': '<!doctype html><div id="root"></div>' }

  it('serves the shell at the address that was configured', async () => {
    const env = makeTestEnv({
      DB: fakeDatabase(async () => siteRow('x7f2k9')),
      ASSETS: fakeAssets(SHELL),
    })

    const response = await send('/x7f2k9/settings', env)

    expect(response.status).toBe(200)
    expect(await response.text()).toContain('id="root"')
  })

  it('stops answering at the address it moved away from', async () => {
    // The whole point: a scanner that tries the default gets nothing that looks
    // like a panel.
    const env = makeTestEnv({
      DB: fakeDatabase(async () => siteRow('x7f2k9')),
      ASSETS: fakeAssets(SHELL),
    })

    const response = await send('/admin', env)

    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain('id="root"')
  })

  it('still serves the panel files from the build directory', async () => {
    // The entry point moves; the files it loads do not. They are a build constant,
    // and hiding them would hide nothing -- the source is public.
    const env = makeTestEnv({
      DB: fakeDatabase(async () => siteRow('x7f2k9')),
      ASSETS: fakeAssets({ '/admin/assets/app.js': 'console.log(1)' }),
    })

    const response = await send('/admin/assets/app.js', env)

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('console.log(1)')
  })

  it('forwards the old address when the browser is already signed in', async () => {
    // Not an announcement of where the panel went: a scanner has no session, and
    // this is the way back in for an operator who changed the setting and cannot
    // remember what they typed.
    const cache = fakeKv()
    const { id } = await createSession(cache.kv, 'admin')
    const env = makeTestEnv({
      CACHE: cache.kv,
      DB: fakeDatabase(async () => siteRow('x7f2k9')),
    })

    const response = await send('/admin/settings', env, {
      headers: { cookie: `${SESSION_COOKIE}=${id}` },
    })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('/x7f2k9/settings')
  })

  it('does not forward anybody else', async () => {
    const env = makeTestEnv({ DB: fakeDatabase(async () => siteRow('x7f2k9')) })

    const response = await send('/admin/settings', env)

    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
  })

  it('answers at the default while the default is what is configured', async () => {
    const env = makeTestEnv({ ASSETS: fakeAssets(SHELL) })

    expect((await send('/admin', env)).status).toBe(200)
  })
})

describe('/api/branding', () => {
  const SITE_ROW = {
    id: 'default',
    name: 'Typeky Demo',
    tagline: null,
    logo_media_id: 'media_logo',
    favicon_media_id: null,
    theme: 'default',
    settings: '{}',
    nav: '[]',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  }

  it('names the site and points at its logo, without a session', async () => {
    const response = await send('/api/branding', makeTestEnv({ DB: fakeDatabase(async () => SITE_ROW) }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      name: 'Typeky Demo',
      logoUrl: 'https://example.com/media/media_logo',
    })
  })

  it('answers with the platform name when there is no site yet', async () => {
    // A fresh deployment: the sign-in screen still has to render something.
    const response = await send('/api/branding', makeTestEnv())

    await expect(response.json()).resolves.toEqual({ name: 'Typeky', logoUrl: null })
  })

  it('carries two fields and nothing else', async () => {
    const response = await send('/api/branding', makeTestEnv({ DB: fakeDatabase(async () => SITE_ROW) }))
    const body = (await response.json()) as Record<string, unknown>

    // The endpoint is public, so everything on it is something a visitor could
    // already see on the site. A third field would be a decision somebody has to
    // make rather than a fact to spread.
    expect(Object.keys(body).sort()).toEqual(['logoUrl', 'name'])
  })
})

describe('escaping', () => {
    it('escapes every character that matters in html', () => {
      expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
    })

    it('does not echo the requested path back', async () => {
      // It used to: the placeholder named the path it could not find. The
      // pipeline answers from content, and neither the bundled 404 nor the setup
      // page says anything about what was asked for -- which is also the safest
      // thing to say.
      const response = await send("/o'brien")

      const html = await response.text()
      expect(html).not.toContain("o'brien")
      expect(html).not.toContain('&#39;')
    })
  })
})
