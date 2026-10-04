import * as z from 'zod/mini'

/**
 * The media library.
 *
 * A media item is metadata about an object in blob storage, not the object
 * itself. `storageKey` is deliberately absent from every shape here: it is how
 * the platform finds the bytes, not something a client should be able to name,
 * and leaving it out means a client cannot ask for an arbitrary object.
 *
 * There is no `url` either. The admin serves bytes from its own path and the
 * site will serve them from its own, so a URL baked into the contract would be
 * wrong for one of them.
 */

export const MEDIA_USAGE_KINDS = ['post', 'page', 'product', 'site'] as const

export const mediaItemSchema = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  byteSize: z.number(),
  width: z.nullable(z.number()),
  height: z.nullable(z.number()),
  altText: z.nullable(z.string()),
  createdAt: z.string(),
})

export type MediaItem = z.infer<typeof mediaItemSchema>

export const mediaListResponseSchema = z.object({
  items: z.array(mediaItemSchema),
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
})

export type MediaListResponse = z.infer<typeof mediaListResponseSchema>

/**
 * An edit to a stored item's metadata.
 *
 * Only the alt text: the bytes and their shape are set by the upload, and a client
 * that could restate them could lie about what the file is. Null is allowed and means
 * "no alt text", which is an answer rather than a missing field -- an operator clearing
 * it should end up with nothing, not with the filename quietly taking its place.
 */
export const mediaMetadataSchema = z.object({
  altText: z.nullable(z.string().check(z.maxLength(300))),
})

export type MediaMetadata = z.infer<typeof mediaMetadataSchema>

/**
 * Where a piece of media is used.
 *
 * Shown before a delete rather than blocking it: the schema clears the
 * references, so the honest thing is to say what will happen and let the
 * operator decide.
 */
export const mediaUsageSchema = z.object({
  total: z.number(),
  places: z.array(
    z.object({
      kind: z.enum(MEDIA_USAGE_KINDS),
      count: z.number(),
    }),
  ),
})

export type MediaUsage = z.infer<typeof mediaUsageSchema>
