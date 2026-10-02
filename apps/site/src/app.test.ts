import { describe, expect, it, vi } from 'vitest'
import { createApp } from './app'
import type { Env } from './env'
import { escapeHtml } from './pages'
import { fakeAssets, fakeDatabase, makeTestEnv } from './testing/env'

/** Hono puts the bindings in the third argument, after RequestInit. */
async function send(path: string, env: Env = makeTestEnv(), init?: RequestInit): Promise<Response> {
  // `request` is typed as returning a Response or a promise of one.
  return createApp().request(new Request(`https://example.com${path}`, init), undefined, env)
}

/** Errors are logged before the 500 page is returned; keep test output readable. */
function silenceErrors(): void {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

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

    it('keeps its own pages out of search results', async () => {
      const response = await send('/nope')

      expect(await response.text()).toContain('name="robots" content="noindex"')
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
