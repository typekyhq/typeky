import { decodeJson, encodeJson, nowIso, uuidv7 } from '@typeky/core'
import type { DbPort } from '@typeky/platform'
import type { ContentType, TenantContext, Vocabulary, VocabularyRepository, VocabularyWrite } from '../../contracts'
import { asDate } from './support'

const COLUMNS = ['id', 'name', 'description', 'content_types', 'sort_order', 'created_at', 'updated_at'].join(', ')

interface VocabularyRow {
  id: string
  name: string
  description: string | null
  content_types: string
  sort_order: number
  created_at: string
  updated_at: string
}

/**
 * The content types this build knows about.
 *
 * Read through this rather than trusted: the column is JSON, so a row written by
 * a newer version could name a content type this one cannot render. Dropping the
 * unknown entry shows the vocabulary as not attached rather than making a picker
 * offer something that does not exist.
 */
const CONTENT_TYPES: readonly string[] = ['post', 'product']

function toContentTypes(text: string): ContentType[] {
  return decodeJson<string[]>(text).filter((value): value is ContentType => CONTENT_TYPES.includes(value))
}

function toVocabulary(row: VocabularyRow): Vocabulary {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    contentTypes: toContentTypes(row.content_types),
    sortOrder: row.sort_order,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }
}

export function createVocabularyRepository(db: DbPort): VocabularyRepository {
  async function byId(id: string): Promise<Vocabulary | null> {
    const row = await db.first<VocabularyRow>(`SELECT ${COLUMNS} FROM vocabularies WHERE id = ?`, [id])
    return row === null ? null : toVocabulary(row)
  }

  /** Appends to the end unless the caller picked a position. */
  async function nextSortOrder(): Promise<number> {
    const row = await db.first<{ next: number | null }>(
      'SELECT max(sort_order) + 1 AS next FROM vocabularies',
    )
    return row?.next ?? 0
  }

  return {
    async list(_ctx: TenantContext): Promise<Vocabulary[]> {
      const rows = await db.all<VocabularyRow>(
        `SELECT ${COLUMNS} FROM vocabularies ORDER BY sort_order ASC, name ASC, id ASC`,
      )
      return rows.map(toVocabulary)
    },

    async byId(_ctx: TenantContext, id: string): Promise<Vocabulary | null> {
      return byId(id)
    },

    async forContentType(_ctx: TenantContext, contentType: ContentType): Promise<Vocabulary[]> {
      // `json_each` rather than a LIKE over the raw text: `["product"]` contains
      // the substring `"post"` in `"product"` only because of the closing quote,
      // and one JSON edit away from not being true.
      const rows = await db.all<VocabularyRow>(
        `SELECT ${COLUMNS} FROM vocabularies
          WHERE EXISTS (SELECT 1 FROM json_each(vocabularies.content_types) WHERE value = ?)
          ORDER BY sort_order ASC, name ASC, id ASC`,
        [contentType],
      )
      return rows.map(toVocabulary)
    },

    async upsert(_ctx: TenantContext, input: VocabularyWrite): Promise<Vocabulary> {
      const timestamp = nowIso()
      const existing = input.id === undefined ? null : await byId(input.id)
      const id = existing?.id ?? input.id ?? uuidv7()

      const name = input.name
      const description = input.description ?? null
      const contentTypes = encodeJson(input.contentTypes ?? existing?.contentTypes ?? [])
      const sortOrder = input.sortOrder ?? existing?.sortOrder ?? (await nextSortOrder())

      if (existing === null) {
        await db.run(
          `INSERT INTO vocabularies (id, name, description, content_types, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, name, description, contentTypes, sortOrder, timestamp, timestamp],
        )
      } else {
        await db.run(
          `UPDATE vocabularies SET name = ?, description = ?, content_types = ?, sort_order = ?, updated_at = ?
            WHERE id = ?`,
          [name, description, contentTypes, sortOrder, timestamp, id],
        )
      }

      const saved = await byId(id)
      if (saved === null) throw new Error(`vocabulary ${id} disappeared during upsert`)
      return saved
    },

    async remove(_ctx: TenantContext, id: string): Promise<boolean> {
      // The terms go with it: `terms.vocabulary_id` cascades, and so does each
      // term's `parent_id`, so a subtree cannot outlive its vocabulary.
      const changes = await db.run('DELETE FROM vocabularies WHERE id = ?', [id])
      return changes > 0
    },
  }
}
