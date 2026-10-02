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

  describe('site pages', () => {
    it('serves the placeholder until the render pipeline lands', async () => {
      const response = await send('/')

      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/html')
      expect(await response.text()).toContain('Typeky is running')
    })

    it('answers an unpublished path with the placeholder, not a 404', async () => {
      // The route table for real pages is built from content, so a miss here is
      // not yet "not found" -- M6 decides that.
      const response = await send('/about')

      expect(response.status).toBe(200)
      expect(await response.text()).toContain('/about')
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

    it('escapes the requested path before echoing it back', async () => {
      // An apostrophe survives URL normalisation, unlike `<` and `"`, so it is
      // the character that actually reaches the page unencoded.
      const response = await send("/o'brien")

      expect(await response.text()).toContain('&#39;')
    })
  })
})
