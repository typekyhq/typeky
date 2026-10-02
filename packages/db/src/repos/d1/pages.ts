import { type Block, decodeJson, decodeTimestamp, encodeJson, nowIso, uuidv7 } from '@typeky/core'
import type { DbPort, SqlParam } from '@typeky/platform'
import { resolveWindow } from '../../contracts'
import type { ListQuery, Page, PageRepository, PageResult, PageWrite, SeoMetadata, TenantContext } from '../../contracts'
import { asBoolean, asDate, searchAcross } from './support'

const COLUMNS = [
  'id',
  'title',
  'slug',
  'content_blocks',
  'seo_metadata',
  'status',
  'is_home',
  'sort_order',
  'revision',
  'published_at',
  'created_at',
  'updated_at',
].join(', ')

interface PageRow {
  id: string
  title: string
  slug: string
  content_blocks: string
  seo_metadata: string
  status: string
  is_home: number
  sort_order: number
  revision: number
  published_at: string | null
  created_at: string
  updated_at: string
}

function toPage(row: PageRow): Page {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    blocks: decodeJson<Block[]>(row.content_blocks),
    seo: decodeJson<SeoMetadata>(row.seo_metadata),
    status: row.status === 'published' ? 'published' : 'draft',
    isHome: asBoolean(row.is_home),
    sortOrder: row.sort_order,
    revision: row.revision,
    publishedAt: decodeTimestamp(row.published_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }
}

export function createPageRepository(db: DbPort): PageRepository {
  async function findById(id: string): Promise<Page | null> {
    const row = await db.first<PageRow>(`SELECT ${COLUMNS} FROM pages WHERE id = ?`, [id])
    return row === null ? null : toPage(row)
  }

  return {
    async list(_ctx: TenantContext, query: ListQuery = {}): Promise<PageResult<Page>> {
      const { limit, offset } = resolveWindow(query)

      const params: SqlParam[] = []
      const conditions: string[] = []
      if (query.status !== undefined) {
        conditions.push('status = ?')
        params.push(query.status)
      }

      const search = query.search?.trim()
      if (search !== undefined && search !== '') {
        const condition = searchAcross(['title', 'slug'], search)
        conditions.push(condition.sql)
        params.push(...condition.params)
      }

      const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

      const count = await db.first<{ total: number }>(`SELECT count(*) AS total FROM pages${where}`, params)
      const rows = await db.all<PageRow>(
        `SELECT ${COLUMNS} FROM pages${where} ORDER BY sort_order ASC, created_at ASC, id ASC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )

      return { items: rows.map(toPage), total: count?.total ?? 0, limit, offset }
    },

    async byId(_ctx: TenantContext, id: string): Promise<Page | null> {
      return findById(id)
    },

    async bySlug(_ctx: TenantContext, slug: string): Promise<Page | null> {
      const row = await db.first<PageRow>(`SELECT ${COLUMNS} FROM pages WHERE slug = ?`, [slug])
      return row === null ? null : toPage(row)
    },

    async home(_ctx: TenantContext): Promise<Page | null> {
      const row = await db.first<PageRow>(`SELECT ${COLUMNS} FROM pages WHERE is_home = 1 LIMIT 1`)
      return row === null ? null : toPage(row)
    },

    async upsert(_ctx: TenantContext, input: PageWrite): Promise<Page> {
      const timestamp = nowIso()
      const existing = input.id === undefined ? null : await findById(input.id)
      const id = existing?.id ?? input.id ?? uuidv7()

      const status = input.status ?? existing?.status ?? 'draft'
      const publishedAt =
        status === 'published' ? (existing?.publishedAt?.toISOString() ?? timestamp) : null
      const revision = (existing?.revision ?? 0) + 1
      const sortOrder = input.sortOrder ?? existing?.sortOrder ?? 0

      const values: SqlParam[] = [
        input.title,
        input.slug,
        encodeJson(input.blocks ?? []),
        encodeJson(input.seo ?? {}),
        status,
        sortOrder,
        revision,
        publishedAt,
      ]

      if (existing === null) {
        // is_home is written as 0 and changed only through setHome, so an upsert
        // can never trip the single-home-page unique index.
        await db.run(
          `INSERT INTO pages (id, title, slug, content_blocks, seo_metadata, status, is_home, sort_order, revision, published_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
          [id, ...values, timestamp, timestamp],
        )
      } else {
        await db.run(
          `UPDATE pages SET title = ?, slug = ?, content_blocks = ?, seo_metadata = ?, status = ?, sort_order = ?, revision = ?, published_at = ?, updated_at = ?
           WHERE id = ?`,
          [...values, timestamp, id],
        )
      }

      const saved = await findById(id)
      if (saved === null) throw new Error(`page ${id} disappeared during upsert`)
      return saved
    },

    async setHome(_ctx: TenantContext, id: string): Promise<Page> {
      const target = await findById(id)
      if (target === null) throw new Error(`page not found: ${id}`)

      // One batch, so there is never a moment with two home pages.
      await db.batch([
        { sql: 'UPDATE pages SET is_home = 0 WHERE is_home = 1 AND id <> ?', params: [id] },
        { sql: 'UPDATE pages SET is_home = 1, updated_at = ? WHERE id = ?', params: [nowIso(), id] },
      ])

      const saved = await findById(id)
      if (saved === null) throw new Error(`page ${id} disappeared while setting it as home`)
      return saved
    },

    async remove(_ctx: TenantContext, id: string): Promise<boolean> {
      const changes = await db.run('DELETE FROM pages WHERE id = ?', [id])
      return changes > 0
    },
  }
}
