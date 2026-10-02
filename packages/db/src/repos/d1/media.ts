import { nowIso, uuidv7 } from '@typeky/core'
import type { DbPort, SqlParam } from '@typeky/platform'
import { resolveWindow } from '../../contracts'
import type {
  ListMediaQuery,
  MediaItem,
  MediaRepository,
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
