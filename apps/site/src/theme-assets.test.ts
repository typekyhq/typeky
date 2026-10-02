import { ASSETS } from '@typeky/theme-default'
import { describe, expect, it } from 'vitest'
import { serveThemeAsset } from './theme-assets'

/**
 * The theme's static files.
 *
 * Two things are worth fixing in tests. The first is that the route is a map
 * lookup rather than a path join, so a name cannot reach anything that is not an
 * asset -- the assertion is that a traversal attempt is answered like any other
 * unknown name. The second is that a deploy changes the bytes at an unchanged
 * URL, which is what the validator is for.
 */

function request(name: string, init?: RequestInit): Response {
  return serveThemeAsset(name, new Request(`https://example.com/theme/${name}`, init))
}

describe('a theme asset', () => {
  it('is served with the media type the generator recorded', async () => {
    const response = request('theme.css')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe(ASSETS['theme.css']?.contentType)
    expect(await response.text()).toBe(ASSETS['theme.css']?.source)
  })

  it('is served with a validator, and cached forever because the URL carries a hash', () => {
    const response = request('theme.css')

    // `asset_url` only produces this URL next to a hash of these bytes, so the
    // response cannot go stale under a browser that keeps it.
    expect(response.headers.get('etag')).toBe(ASSETS['theme.css']?.etag)
    expect(response.headers.get('cache-control')).toContain('immutable')
  })

  it('answers an unchanged request with the validator and no body', async () => {
    const etag = ASSETS['theme.css']?.etag ?? ''
    const response = request('theme.css', { headers: { 'if-none-match': etag } })

    expect(response.status).toBe(304)
    expect(await response.text()).toBe('')
  })

  it('does not treat a mismatched validator as a match', async () => {
    const response = request('theme.css', { headers: { 'if-none-match': '"something-else"' } })

    expect(response.status).toBe(200)
  })

  it('cannot be walked out of, because there is nowhere to walk to', async () => {
    for (const name of ['../package.json', '..%2F..%2Fpackage.json', 'assets/theme.css', '']) {
      const response = request(name)

      expect(response.status).toBe(404)
      expect(response.headers.get('content-type')).toContain('text/plain')
      // Not even the name comes back: a 404 that echoes the request is a way to
      // find out what the request was.
      expect(await response.text()).toBe('Not Found')
    }
  })

  it('is not cached when it is missing', async () => {
    // A cached miss outlives the deploy that adds the file: the page would stay
    // unstyled until the browser's heuristic expiry, which is how this was found
    // the first time.
    const response = request('missing.css')

    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  it('ignores the version query the filter adds, because the hash is the browser’s business', async () => {
    // The route looks the name up in a map; `?v=` must not become part of it.
    const withVersion = serveThemeAsset('theme.css', new Request('https://example.com/theme/theme.css?v=4a4f5fb4'))

    expect(withVersion.status).toBe(200)
    expect(await withVersion.text()).toBe(ASSETS['theme.css']?.source)
  })

  it('serves the script the cookie notice asks for', () => {
    // The snippet renders `{{ 'theme.js' | asset_url }}` when a notice is
    // configured, so a missing file would be a 404 on every page of a site that
    // set one.
    const response = request('theme.js')

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/javascript')
  })
})
