import { defaultContext } from '@typeky/db'
import { blobsFor } from './blobs'
import type { Env } from './env'
import { repositoriesFor } from './repositories'

/**
 * A media object, served to visitors.
 *
 * Public and immutable. A media id names one object for good -- a new upload gets
 * a new id rather than replacing one -- so a year-long cache is safe, and it is
 * the reason the render context carries ids: a storage key in a URL would make
 * every cached page wrong the day the bucket is reorganised.
 *
 * The bytes come from the bucket through the same port the admin uploads
 * through, so there is one implementation of "where the objects are".
 */
export async function serveMedia(env: Env, id: string, request: Request): Promise<Response> {
  const store = repositoriesFor(env)
  const blobs = blobsFor(env)

  if (store === null || blobs === null) return notFound()

  const item = await store.media.byId(defaultContext(), id)
  if (item === null) return notFound()

  const object = await blobs.get(item.storageKey)
  if (object === null) return notFound()

  const etag = `"${id}"`

  // A conditional request is answered without touching the bucket body again.
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers: { etag, 'cache-control': CACHE_CONTROL } })
  }

  return new Response(object.body, {
    headers: {
      'content-type': object.contentType ?? item.mimeType,
      'content-length': String(object.byteSize),
      etag,
      'cache-control': CACHE_CONTROL,
      // A theme's image is not a place for a script to run from, and saying so
      // costs nothing.
      'x-content-type-options': 'nosniff',
    },
  })
}

const CACHE_CONTROL = 'public, max-age=31536000, immutable'

function notFound(): Response {
  return new Response('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } })
}
