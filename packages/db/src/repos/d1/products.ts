import { decodeJson, decodeTimestamp, encodeJson, nowIso, uuidv7 } from '@typeky/core'
import type { DbPort, SqlParam } from '@typeky/platform'
import { resolveWindow } from '../../contracts'
import type {
  ListQuery,
  Product,
  ProductRepository,
  ProductSpec,
  ProductWrite,
  SeoMetadata,
  TenantContext,
} from '../../contracts'
import { asDate } from './support'

const COLUMNS = [
  'id',
  'title',
  'slug',
  'summary',
  'content_blocks',
  'cover_media_id',
  'gallery',
  'specs',
  'price_label',
  'cta_label',
  'cta_url',
  'seo_metadata',
  'status',
  'sort_order',
  'revision',
  'published_at',
  'created_at',
  'updated_at',
].join(', ')

interface ProductRow {
  id: string
  title: string
  slug: string
  summary: string | null
  content_blocks: string
  cover_media_id: string | null
  gallery: string
  specs: string
  price_label: string | null
  cta_label: string | null
  cta_url: string | null
  seo_metadata: string
  status: string
  sort_order: number
  revision: number
  published_at: string | null
  created_at: string
  updated_at: string
}

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    blocks: decodeJson<unknown[]>(row.content_blocks),
    coverMediaId: row.cover_media_id,
    gallery: decodeJson<string[]>(row.gallery),
    specs: decodeJson<ProductSpec[]>(row.specs),
    priceLabel: row.price_label,
    ctaLabel: row.cta_label,
    ctaUrl: row.cta_url,
    seo: decodeJson<SeoMetadata>(row.seo_metadata),
    status: row.status === 'published' ? 'published' : 'draft',
    sortOrder: row.sort_order,
    revision: row.revision,
    publishedAt: decodeTimestamp(row.published_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }
}

export function createProductRepository(db: DbPort): ProductRepository {
  async function findById(id: string): Promise<Product | null> {
    const row = await db.first<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE id = ?`, [id])
    return row === null ? null : toProduct(row)
  }

  return {
    async list(_ctx: TenantContext, query: ListQuery = {}) {
      const { limit, offset } = resolveWindow(query)

      const params: SqlParam[] = []
      const conditions: string[] = []
      if (query.status !== undefined) {
        conditions.push('status = ?')
        params.push(query.status)
      }
      const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

      const count = await db.first<{ total: number }>(`SELECT count(*) AS total FROM products${where}`, params)
      const rows = await db.all<ProductRow>(
        `SELECT ${COLUMNS} FROM products${where} ORDER BY sort_order ASC, created_at ASC, id ASC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )

      return { items: rows.map(toProduct), total: count?.total ?? 0, limit, offset }
    },

    async byId(_ctx: TenantContext, id: string) {
      return findById(id)
    },

    async bySlug(_ctx: TenantContext, slug: string) {
      const row = await db.first<ProductRow>(`SELECT ${COLUMNS} FROM products WHERE slug = ?`, [slug])
      return row === null ? null : toProduct(row)
    },

    async upsert(_ctx: TenantContext, input: ProductWrite): Promise<Product> {
      const timestamp = nowIso()
      const existing = input.id === undefined ? null : await findById(input.id)
      const id = existing?.id ?? input.id ?? uuidv7()

      const status = input.status ?? existing?.status ?? 'draft'
      const publishedAt =
        status === 'published' ? (existing?.publishedAt?.toISOString() ?? timestamp) : null
      const revision = (existing?.revision ?? 0) + 1
      const sortOrder = input.sortOrder ?? existing?.sortOrder ?? 0

      const title = input.title
      const slug = input.slug
      const summary = input.summary ?? null
      const blocks = encodeJson(input.blocks ?? [])
      const coverMediaId = input.coverMediaId ?? null
      const gallery = encodeJson(input.gallery ?? [])
      const specs = encodeJson(input.specs ?? [])
      const priceLabel = input.priceLabel ?? null
      const ctaLabel = input.ctaLabel ?? null
      const ctaUrl = input.ctaUrl ?? null
      const seo = encodeJson(input.seo ?? {})

      if (existing === null) {
        await db.run(
          `INSERT INTO products (id, title, slug, summary, content_blocks, cover_media_id, gallery, specs, price_label, cta_label, cta_url, seo_metadata, status, sort_order, revision, published_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            title,
            slug,
            summary,
            blocks,
            coverMediaId,
            gallery,
            specs,
            priceLabel,
            ctaLabel,
            ctaUrl,
            seo,
            status,
            sortOrder,
            revision,
            publishedAt,
            timestamp,
            timestamp,
          ],
        )
      } else {
        await db.run(
          `UPDATE products SET title = ?, slug = ?, summary = ?, content_blocks = ?, cover_media_id = ?, gallery = ?, specs = ?, price_label = ?, cta_label = ?, cta_url = ?, seo_metadata = ?, status = ?, sort_order = ?, revision = ?, published_at = ?, updated_at = ?
           WHERE id = ?`,
          [
            title,
            slug,
            summary,
            blocks,
            coverMediaId,
            gallery,
            specs,
            priceLabel,
            ctaLabel,
            ctaUrl,
            seo,
            status,
            sortOrder,
            revision,
            publishedAt,
            timestamp,
            id,
          ],
        )
      }

      const saved = await findById(id)
      if (saved === null) throw new Error(`product ${id} disappeared during upsert`)
      return saved
    },

    async remove(_ctx: TenantContext, id: string): Promise<boolean> {
      const changes = await db.run('DELETE FROM products WHERE id = ?', [id])
      return changes > 0
    },
  }
}
