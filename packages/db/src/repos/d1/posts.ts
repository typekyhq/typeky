import { type Block, decodeJson, decodeTimestamp, encodeJson, nowIso, uuidv7 } from '@typeky/core'
import type { DbPort, SqlParam } from '@typeky/platform'
import { escapeLikeTerm, resolveWindow } from '../../contracts'
import type { ListPostsQuery, Post, PostRepository, PostWrite, SeoMetadata, TenantContext } from '../../contracts'
import { asDate } from './support'

const COLUMNS = [
  'id',
  'title',
  'slug',
  'excerpt',
  'cover_media_id',
  'content_blocks',
  'tags',
  'category',
  'seo_metadata',
  'status',
  'revision',
  'published_at',
  'created_at',
  'updated_at',
].join(', ')

interface PostRow {
  id: string
  title: string
  slug: string
  excerpt: string | null
  cover_media_id: string | null
  content_blocks: string
  tags: string
  category: string | null
  seo_metadata: string
  status: string
  revision: number
  published_at: string | null
  created_at: string
  updated_at: string
}

function toPost(row: PostRow): Post {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug,
    excerpt: row.excerpt,
    coverMediaId: row.cover_media_id,
    blocks: decodeJson<Block[]>(row.content_blocks),
    tags: decodeJson<string[]>(row.tags),
    category: row.category,
    seo: decodeJson<SeoMetadata>(row.seo_metadata),
    status: row.status === 'published' ? 'published' : 'draft',
    revision: row.revision,
    publishedAt: decodeTimestamp(row.published_at),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }
}

export function createPostRepository(db: DbPort): PostRepository {
  async function findById(id: string): Promise<Post | null> {
    const row = await db.first<PostRow>(`SELECT ${COLUMNS} FROM posts WHERE id = ?`, [id])
    return row === null ? null : toPost(row)
  }

  return {
    async list(_ctx: TenantContext, query: ListPostsQuery = {}) {
      const { limit, offset } = resolveWindow(query)

      const params: SqlParam[] = []
      const conditions: string[] = []
      if (query.status !== undefined) {
        conditions.push('status = ?')
        params.push(query.status)
      }
      if (query.category !== undefined) {
        conditions.push('category = ?')
        params.push(query.category)
      }

      // `lower()` on both sides rather than `LIKE`, which is only
      // case-insensitive for ASCII in SQLite. `coalesce` because a null excerpt
      // would make the whole comparison null, and a null condition is not a
      // false one in the way the surrounding AND expects.
      const search = query.search?.trim()
      if (search !== undefined && search !== '') {
        const term = `%${escapeLikeTerm(search.toLowerCase())}%`
        conditions.push(
          `(lower(title) LIKE ? ESCAPE '\\' OR lower(slug) LIKE ? ESCAPE '\\' OR lower(coalesce(excerpt, '')) LIKE ? ESCAPE '\\')`,
        )
        params.push(term, term, term)
      }

      const where = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : ''

      const count = await db.first<{ total: number }>(`SELECT count(*) AS total FROM posts${where}`, params)

      // Matches idx_posts_published when a status filter is present. Unpublished
      // posts have a null published_at, which SQLite sorts last under DESC. The
      // id tie-breaker keeps the order total, so OFFSET paging cannot repeat or
      // skip a row when several posts share a timestamp.
      const rows = await db.all<PostRow>(
        `SELECT ${COLUMNS} FROM posts${where} ORDER BY published_at DESC, created_at DESC, id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      )

      return { items: rows.map(toPost), total: count?.total ?? 0, limit, offset }
    },

    async byId(_ctx: TenantContext, id: string) {
      return findById(id)
    },

    async bySlug(_ctx: TenantContext, slug: string) {
      const row = await db.first<PostRow>(`SELECT ${COLUMNS} FROM posts WHERE slug = ?`, [slug])
      return row === null ? null : toPost(row)
    },

    async upsert(_ctx: TenantContext, input: PostWrite): Promise<Post> {
      const timestamp = nowIso()
      const existing = input.id === undefined ? null : await findById(input.id)
      const id = existing?.id ?? input.id ?? uuidv7()

      const status = input.status ?? existing?.status ?? 'draft'
      const publishedAt =
        status === 'published' ? (existing?.publishedAt?.toISOString() ?? timestamp) : null
      const revision = (existing?.revision ?? 0) + 1

      const title = input.title
      const slug = input.slug
      const excerpt = input.excerpt ?? null
      const coverMediaId = input.coverMediaId ?? null
      const blocks = encodeJson(input.blocks ?? [])
      const tags = encodeJson(input.tags ?? [])
      const category = input.category ?? null
      const seo = encodeJson(input.seo ?? {})

      if (existing === null) {
        await db.run(
          `INSERT INTO posts (id, title, slug, excerpt, cover_media_id, content_blocks, tags, category, seo_metadata, status, revision, published_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            title,
            slug,
            excerpt,
            coverMediaId,
            blocks,
            tags,
            category,
            seo,
            status,
            revision,
            publishedAt,
            timestamp,
            timestamp,
          ],
        )
      } else {
        await db.run(
          `UPDATE posts SET title = ?, slug = ?, excerpt = ?, cover_media_id = ?, content_blocks = ?, tags = ?, category = ?, seo_metadata = ?, status = ?, revision = ?, published_at = ?, updated_at = ?
           WHERE id = ?`,
          [
            title,
            slug,
            excerpt,
            coverMediaId,
            blocks,
            tags,
            category,
            seo,
            status,
            revision,
            publishedAt,
            timestamp,
            id,
          ],
        )
      }

      const saved = await findById(id)
      if (saved === null) throw new Error(`post ${id} disappeared during upsert`)
      return saved
    },

    async remove(_ctx: TenantContext, id: string): Promise<boolean> {
      const changes = await db.run('DELETE FROM posts WHERE id = ?', [id])
      return changes > 0
    },
  }
}
