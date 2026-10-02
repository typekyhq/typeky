/**
 * @typeky/platform -- Platform ports and their adapters
 *
 * Layout and responsibilities: CONTRIBUTING.md section 6
 * Architecture red lines: CONTRIBUTING.md section 3
 *
 * Ports describe the data access surface. Adapters live under `cloudflare/`;
 * test doubles under `testing/`, which is exported separately so Node-only code
 * never reaches a Worker bundle.
 */

export { createD1DbPort, type D1LikeDatabase, type D1LikePreparedStatement } from './cloudflare/d1'
export { createR2Blob, type R2LikeBucket, type R2LikeObjectBody, type R2LikeObjectInfo } from './cloudflare/r2'
export type { BlobContents, BlobPort, DbPort, DbStatement, SqlParam } from './ports'
