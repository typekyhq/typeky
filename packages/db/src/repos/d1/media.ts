import { nowIso, uuidv7 } from '@typeky/core'
import type { DbPort, SqlParam } from '@typeky/platform'
import { resolveWindow } from '../../contracts'
import type {
  ListMediaQuery,
  MediaItem,
  MediaRepository,
  MediaUsage,
  MediaWrite,
  PageResult,
  TenantContext,
} from '../../contracts'
import { asDate } from './support'

const COLUMNS = [
  'id',
  'filename',
  'storage_key',
  'mime_type',
  'byte_size',
  'width',
  'height',
  'alt_text',
  'created_at',
].join(', ')

interface MediaRow {
  id: string
  filename: string
  storage_key: string
  mime_type: string
  byte_size: number
  width: number | null
  height: number | null
  alt_text: string | null
  created_at: string
}

function toMediaItem(row: MediaRow): MediaItem {
  return {
    id: row.id,
    filename: row.filename,
    storageKey: row.storage_key,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    width: row.width,
    height: row.height,
    altText: row.alt_text,
    createdAt: asDate(row.created_at),
  }
}

export function createMediaRepository(db: DbPort): MediaRepository {
  async function findById(id: string): Promise<MediaItem | null> {
    const row = await db.first<MediaRow>(`SELECT ${COLUMNS} FROM media WHERE id = ?`, [id])
    return row === null ? null : toMediaItem(row)
  }

  return {
    async list(_ctx: TenantContext, query: ListMediaQuery = {}): Promise<PageResult<MediaItem>> {
      const { limit, offset } = resolveWindow(query)

      const params: SqlParam[] = []
      let where = ''
      if (query.search !== undefined && query.search.trim() !== '') {
        where = ' WHERE filename LIKE ? OR alt_text LIKE ?'
        const pattern = `%${query.search.trim()}%`
        params.push(pattern, pattern)
      }

      const count = await db.first<{ total: number }>(`SELECT count(*) AS total FROM media${where}`, params)
      const rows = await db.all<MediaRow>(
        `SELECT ${COLUMNS} FROM media${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )

      return { items: rows.map(toMediaItem), total: count?.total ?? 0, limit, offset }
    },

    async byId(_ctx: TenantContext, id: string): Promise<MediaItem | null> {
      return findById(id)
    },

    /**
     * Counts the rows that reference this media.
     *
     * Three shapes to look in, and missing any of them would understate the
     * answer: a direct column (`cover_media_id`, `logo_media_id`), the gallery
     * array, and a JSON body -- blocks hold media ids for images and videos, and
     * `seo_metadata` holds one for the Open Graph image. `json_tree` walks those
     * recursively, so an image inside a nested list is found too.
     */
    async usages(_ctx: TenantContext, id: string): Promise<MediaUsage> {
      const places: MediaUsage['places'] = []

      const counts: ReadonlyArray<{ kind: MediaUsage['places'][number]['kind']; sql: string }> = [
        {
          kind: 'post',
          sql: `SELECT count(*) AS n FROM posts
                WHERE cover_media_id = ?
                   OR EXISTS (SELECT 1 FROM json_tree(posts.content_blocks) WHERE json_tree.value = ?)
                   OR EXISTS (SELECT 1 FROM json_tree(posts.seo_metadata) WHERE json_tree.value = ?)`,
        },
        {
          kind: 'page',
          sql: `SELECT count(*) AS n FROM pages
                WHERE EXISTS (SELECT 1 FROM json_tree(pages.content_blocks) WHERE json_tree.value = ?)
                   OR EXISTS (SELECT 1 FROM json_tree(pages.seo_metadata) WHERE json_tree.value = ?)`,
        },
        {
          kind: 'product',
          sql: `SELECT count(*) AS n FROM products
                WHERE cover_media_id = ?
                   OR EXISTS (SELECT 1 FROM json_tree(products.gallery) WHERE json_tree.value = ?)
                   OR EXISTS (SELECT 1 FROM json_tree(products.content_blocks) WHERE json_tree.value = ?)
                   OR EXISTS (SELECT 1 FROM json_tree(products.seo_metadata) WHERE json_tree.value = ?)`,
        },
        {
          kind: 'site',
          sql: 'SELECT count(*) AS n FROM sites WHERE logo_media_id = ?',
        },
      ]

      for (const { kind, sql } of counts) {
        // Every placeholder in these queries is the media id, so the parameter
        // list is the id repeated as many times as there are `?`. Deriving it
        // rather than writing it out keeps the two from drifting when a query
        // gains another column to look in.
        const parameters = Array.from({ length: (sql.match(/\?/g) ?? []).length }, () => id)
        const row = await db.first<{ n: number }>(sql, parameters)

        if ((row?.n ?? 0) > 0) places.push({ kind, count: row?.n ?? 0 })
      }

      return { total: places.reduce((sum, place) => sum + place.count, 0), places }
    },

    async insert(_ctx: TenantContext, input: MediaWrite): Promise<MediaItem> {
      const id = input.id ?? uuidv7()

      await db.run(
        `INSERT INTO media (id, filename, storage_key, mime_type, byte_size, width, height, alt_text, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          input.filename,
          input.storageKey,
          input.mimeType,
          input.byteSize,
          input.width ?? null,
          input.height ?? null,
          input.altText ?? null,
          nowIso(),
        ],
      )

      const saved = await findById(id)
      if (saved === null) throw new Error(`media ${id} disappeared during insert`)
      return saved
    },

    async remove(_ctx: TenantContext, id: string): Promise<boolean> {
      // Content rows referencing this media are cleared by the schema's
      // ON DELETE SET NULL rather than the delete being refused.
      const changes = await db.run('DELETE FROM media WHERE id = ?', [id])
      return changes > 0
    },
  }
}
