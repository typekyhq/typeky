import { ASSETS } from '@typeky/theme-default'

/**
 * The theme's static files.
 *
 * A theme writes `{{ 'theme.css' | asset_url }}` and the platform answers it,
 * because a theme author should not have to know where a file physically is --
 * in this build it is embedded in the Worker bundle, and it could just as easily
 * be an object in the bucket without any template changing.
 *
 * The lookup is a map access on the requested name, so a path cannot escape the
 * asset set: there is no filesystem to traverse, and `../` is simply a name that
 * is not in the map. That is why the name is not decoded or normalised here --
 * doing either would only create a difference between what is looked up and what
 * was asked for. A query string is ignored for the same reason: `asset_url` puts
 * a content hash there, and the hash is the browser's business, not the lookup's.
 *
 * Caching is split by what a miss means. A hit is immutable, because `asset_url`
 * only produces this URL alongside a hash of these bytes. A miss is `no-store`,
 * because "this file does not exist" is a statement a deploy can falsify -- and a
 * browser that cached it would keep the page unstyled after the file appeared.
 */
export function serveThemeAsset(name: string, request: Request): Response {
  const asset = ASSETS[name]
  if (asset === undefined) return notFound()

  const headers = {
    'content-type': asset.contentType,
    etag: asset.etag,
    'cache-control': 'public, max-age=31536000, immutable',
    // A stylesheet is not a script and a script is not a document; saying so
    // stops a browser from sniffing one into being another.
    'x-content-type-options': 'nosniff',
  }

  // A conditional request is answered with the validator and no body, which is
  // what a browser sends once the immutable copy expires out of its disk cache.
  if (request.headers.get('if-none-match') === asset.etag) {
    return new Response(null, { status: 304, headers })
  }

  return new Response(asset.source, { headers })
}

/**
 * An asset of a theme that was uploaded.
 *
 * The bytes come from the database rather than from the bundle, and the content type
 * from the extension, because there is no build to have written either down. No
 * ETag: `asset_url` already puts the file's revision in the query string, so the URL
 * changes when the bytes do and a conditional request never has to be answered.
 */
export function serveUploadedThemeAsset(name: string, source: string): Response {
  return new Response(source, {
    headers: {
      'content-type': uploadedContentType(name),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  })
}

function uploadedContentType(name: string): string {
  if (name.endsWith('.css')) return 'text/css; charset=utf-8'
  if (name.endsWith('.js') || name.endsWith('.mjs')) return 'text/javascript; charset=utf-8'
  if (name.endsWith('.svg')) return 'image/svg+xml'
  if (name.endsWith('.json')) return 'application/json; charset=utf-8'

  return 'text/plain; charset=utf-8'
}

/** The same 404 an asset that is not in the theme answers with. */
export function themeAssetNotFound(): Response {
  return notFound()
}

function notFound(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'x-content-type-options': 'nosniff',
      // See above: a cached miss outlives the deploy that fixes it.
      'cache-control': 'no-store',
    },
  })
}
