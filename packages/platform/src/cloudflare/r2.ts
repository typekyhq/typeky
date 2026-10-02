import type { BlobContents, BlobPort } from '../ports'

/**
 * The subset of the Cloudflare R2 binding this adapter touches.
 *
 * Written structurally for the same reason as the D1 adapter: importing the
 * binding type would drag Cloudflare into the codebase, which red line 3
 * forbids, and the package would stop being usable from Node. The real
 * `env.MEDIA` is assignable to this shape, and a drift between the two shows up
 * as a type error at the composition root, where the binding is read.
 */

/** What a write answers with: the object's size as stored. */
export interface R2LikeObjectInfo {
  size: number
}

/** What a read answers with, including the body. */
export interface R2LikeObjectBody extends R2LikeObjectInfo {
  body: ReadableStream
  httpMetadata?: { contentType?: string } | null
}

export interface R2LikeBucket {
  put(
    key: string,
    value: ReadableStream,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<R2LikeObjectInfo | null>
  get(key: string): Promise<R2LikeObjectBody | null>
  delete(key: string): Promise<void>
}

export function createR2Blob(bucket: R2LikeBucket): BlobPort {
  return {
    async put(key, body, contentType) {
      const stored = await bucket.put(key, body, { httpMetadata: { contentType } })
      if (stored === null) throw new Error(`the bucket refused the write for ${key}`)

      return { byteSize: stored.size }
    },

    async get(key): Promise<BlobContents | null> {
      const object = await bucket.get(key)
      if (object === null) return null

      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType ?? null,
        byteSize: object.size,
      }
    },

    async delete(key) {
      await bucket.delete(key)
    },
  }
}
