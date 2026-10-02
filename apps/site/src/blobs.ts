import { createR2Blob, type BlobPort } from '@typeky/platform'
import type { Env } from './env'

/**
 * Blob storage for the current request.
 *
 * Built per request for the same reason as the repositories: the binding only
 * exists on the env object. Null rather than a throw, so a deployment without a
 * bucket reports that clearly instead of failing partway through an upload.
 */
export function blobsFor(env: Env): BlobPort | null {
  if (env.MEDIA === undefined) return null

  return createR2Blob(env.MEDIA)
}
