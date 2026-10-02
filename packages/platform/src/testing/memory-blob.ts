import type { BlobContents, BlobPort } from '../ports'

/**
 * An in-memory bucket for tests and for local work without a binding.
 *
 * It buffers rather than streams, which is the one thing a test double can do
 * that the real adapter must not -- but a test that uploads a photograph is not
 * measuring memory, and this keeps the adapter itself stream-only.
 */

export interface MemoryBlob extends BlobPort {
  /** Every stored key, in insertion order. For assertions. */
  keys(): string[]
}

export function createMemoryBlob(): MemoryBlob {
  // Held as ArrayBuffer rather than Uint8Array: the latter is generic over its
  // backing buffer, and constructing a Blob from one needs a cast that would
  // hide the distinction the type is there to make.
  const objects = new Map<string, { bytes: ArrayBuffer; contentType: string }>()

  return {
    async put(key, body, contentType) {
      const bytes = await new Response(body).arrayBuffer()
      objects.set(key, { bytes, contentType })

      return { byteSize: bytes.byteLength }
    },

    async get(key): Promise<BlobContents | null> {
      const stored = objects.get(key)
      if (stored === undefined) return null

      return {
        // A fresh stream each time, so reading twice does not hand out a
        // consumed one.
        body: new Blob([stored.bytes]).stream(),
        contentType: stored.contentType,
        byteSize: stored.bytes.byteLength,
      }
    },

    async delete(key) {
      objects.delete(key)
    },

    keys() {
      return [...objects.keys()]
    },
  }
}
