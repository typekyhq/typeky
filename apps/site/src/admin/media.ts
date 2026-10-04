import {
  mediaMetadataSchema,
  type MediaItem as MediaResponse,
  type MediaListResponse,
  type MediaUsage,
} from '@typeky/api'
import { uuidv7 } from '@typeky/core'
import { defaultContext, type MediaItem, type Repositories } from '@typeky/db'
import type { BlobPort } from '@typeky/platform'
import type { Context } from 'hono'
import { apiError, readJsonBody, type AdminEnv, type BlobResolver, type RepositoryResolver } from './errors'

/**
 * The media library.
 *
 * Uploads go through the Worker rather than straight to R2. Direct uploads need
 * an S3 token the R2 binding does not provide, and the Worker route is the
 * simpler deployment: same origin, no extra secret, and a photograph is far
 * below the request-size limit. The body is streamed to the bucket rather than
 * buffered, because a Worker has a fixed memory budget and a photo can be most
 * of it.
 *
 * What is stored is the object plus a metadata row. The row is what content
 * references; the object is found by the storage key on that row.
 */

/**
 * Accepted types.
 *
 * No SVG. It is an image to a browser and a script host to everyone else, and
 * these bytes are served back from the site's own origin, where that script
 * would run with the site's cookies and storage.
 */
const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'video/mp4',
  'video/webm',
]

/**
 * The upload ceiling.
 *
 * Checked against `Content-Length` before the body is read. A declared length is
 * not proof, but the alternative -- counting while streaming -- cannot refuse
 * after the fact either, and a same-origin form upload is not the threat worth
 * buffering every file for.
 */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

export async function readMedia(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const search = c.req.query('search')?.slice(0, 200)
  const limit = toInteger(c.req.query('limit'))
  const offset = toInteger(c.req.query('offset'))

  const result = await store.media.list(defaultContext(), {
    ...(search === undefined || search.trim() === '' ? {} : { search }),
    ...(limit === undefined ? {} : { limit }),
    ...(offset === undefined ? {} : { offset }),
  })

  const body: MediaListResponse = {
    items: result.items.map(toResponse),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  }

  return c.json(body)
}

/**
 * Stores an upload and records it.
 *
 * The metadata that is not in the bytes -- the filename, the alt text and the
 * dimensions the browser measured -- arrives as query parameters, and the body
 * is the file itself with its own content type.
 */
export async function uploadMedia(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
  blobs: BlobResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const bucket = blobs(c.env)
  if (bucket === null) return apiError(c, 'storage_not_configured')

  const request = c.req.raw
  if (request.body === null) return apiError(c, 'invalid_request', 'the request has no body')

  const mimeType = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return apiError(c, 'invalid_request', `unsupported content type: ${mimeType === '' ? 'none' : mimeType}`)
  }

  const declaredSize = Number(request.headers.get('content-length') ?? '0')
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return apiError(c, 'invalid_request', 'the upload must declare its length')
  }
  if (declaredSize > MAX_UPLOAD_BYTES) {
    return apiError(
      c,
      'invalid_request',
      `the file is larger than the ${String(Math.round(MAX_UPLOAD_BYTES / 1024 / 1024))} MB limit`,
    )
  }

  const filename = cleanFilename(c.req.query('filename') ?? 'file')
  // Generated here rather than by the insert, because the object's key is built
  // from it and the object is written first.
  const id = uuidv7()
  const storageKey = toStorageKey(id, filename)

  const written = await bucket.put(storageKey, request.body, mimeType)

  const item = await store.media.insert(defaultContext(), {
    id,
    filename,
    storageKey,
    mimeType,
    // The size the bucket reports, not the one that was declared: a transfer cut
    // short has to be recorded as the length it really has.
    byteSize: written.byteSize,
    width: toInteger(c.req.query('width')) ?? null,
    height: toInteger(c.req.query('height')) ?? null,
    altText: c.req.query('alt')?.slice(0, 300) ?? null,
  })

  return c.json(toResponse(item), 201)
}

/**
 * Edits the metadata a person can change.
 *
 * Only the alt text. That is the one field worth coming back to: it is written for a
 * screen reader, and the sentence an operator had at upload time is often not the
 * sentence they want later. The bytes are not editable here -- replacing a file is an
 * upload, which keeps the storage key and the object it points at in one piece.
 */
export async function updateMedia(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const item = await findMedia(store, c.req.param('id'))
  if (item === null) return apiError(c, 'not_found', 'no media with that id')

  const parsed = mediaMetadataSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) {
    return apiError(c, 'invalid_request', 'the alt text may be at most 300 characters')
  }

  const saved = await store.media.update(defaultContext(), item.id, parsed.data)
  if (saved === null) return apiError(c, 'not_found', 'no media with that id')

  return c.json(toResponse(saved))
}

/** The bytes, streamed back. Behind the session, like everything else here. */
export async function readMediaContent(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
  blobs: BlobResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const bucket = blobs(c.env)
  if (bucket === null) return apiError(c, 'storage_not_configured')

  const item = await findMedia(store, c.req.param('id'))
  if (item === null) return apiError(c, 'not_found', 'no media with that id')

  const object = await bucket.get(item.storageKey)
  if (object === null) {
    // The row and the object have come apart. Saying so beats an empty image.
    return apiError(c, 'not_found', 'the stored object is missing')
  }

  return new Response(object.body, {
    headers: {
      'content-type': object.contentType ?? item.mimeType,
      'content-length': String(object.byteSize),
      // Private: these bytes are behind the admin session, and a shared cache
      // must not be able to hand them to somebody else.
      'cache-control': 'private, max-age=3600',
    },
  })
}

/** What a delete would affect, so the operator can decide before it happens. */
export async function readMediaUsages(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const item = await findMedia(store, c.req.param('id'))
  if (item === null) return apiError(c, 'not_found', 'no media with that id')

  const usage: MediaUsage = await store.media.usages(defaultContext(), item.id)
  return c.json(usage)
}

/**
 * Removes the row and the object.
 *
 * The row goes first: if the object delete fails, the leftover blob is invisible
 * and collectable, whereas an object deleted while its row survives is a broken
 * image everywhere the row is referenced.
 */
export async function deleteMedia(
  c: Context<AdminEnv>,
  repositories: RepositoryResolver,
  blobs: BlobResolver,
): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const item = await findMedia(store, c.req.param('id'))
  if (item === null) return apiError(c, 'not_found', 'no media with that id')

  await store.media.remove(defaultContext(), item.id)

  const bucket = blobs(c.env)
  if (bucket !== null) await bucket.delete(item.storageKey)

  return c.body(null, 204)
}

/* -------------------------------------------------------------- helpers -- */

async function findMedia(store: Repositories, id: string | undefined): Promise<MediaItem | null> {
  if (id === undefined || id === '') return null
  return store.media.byId(defaultContext(), id)
}

/**
 * A filename fit to store.
 *
 * The original is kept for display; this is the reduced form used in the key.
 * Both path separators and anything that would need escaping go, so a crafted
 * name cannot climb out of the prefix or produce an object nobody can address.
 *
 * Truncation keeps the extension: the end of a name is the part that says what
 * the file is, and cutting there would leave an object nothing can identify.
 */
function cleanFilename(filename: string): string {
  const trimmed = filename.trim().replace(/[\\/]/g, '-')
  if (trimmed === '') return 'file'
  if (trimmed.length <= MAX_FILENAME_LENGTH) return trimmed

  const dot = trimmed.lastIndexOf('.')
  const extension = dot > 0 ? trimmed.slice(dot, dot + 12) : ''

  return trimmed.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension
}

const MAX_FILENAME_LENGTH = 200

function toStorageKey(id: string, filename: string): string {
  const reduced = filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    // The tail, so the extension survives a long name being cut.
    .slice(-80)

  return `media/${id}/${reduced === '' ? 'file' : reduced}`
}

function toInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined

  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

function toResponse(item: MediaItem): MediaResponse {
  return {
    id: item.id,
    filename: item.filename,
    mimeType: item.mimeType,
    byteSize: item.byteSize,
    width: item.width,
    height: item.height,
    altText: item.altText,
    createdAt: item.createdAt.toISOString(),
  }
}
