import { nowIso, uuidv7 } from '@typeky/core'
import type { DbPort, SqlParam } from '@typeky/platform'
import type { ContentType, TenantContext, Term, TermNode, TermRepository, TermWrite } from '../../contracts'
import { asDate } from './support'

const NAMES = [
  'id',
  'vocabulary_id',
  'parent_id',
  'name',
  'slug',
  'description',
  'sort_order',
  'created_at',
  'updated_at',
]

const COLUMNS = NAMES.join(', ')

/** The same list, qualified for the one query that joins another table. */
const QUALIFIED_COLUMNS = NAMES.map((name) => `t.${name}`).join(', ')

interface TermRow {
  id: string
  vocabulary_id: string
  parent_id: string | null
  name: string
  slug: string
  description: string | null
  sort_order: number
  created_at: string
  updated_at: string
}

function toTerm(row: TermRow): Term {
  return {
    id: row.id,
    vocabularyId: row.vocabulary_id,
    parentId: row.parent_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    sortOrder: row.sort_order,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }
}

/**
 * Assembles a flat, ordered list into the tree the admin renders.
 *
 * A term whose parent is not in the list is treated as a root rather than
 * dropped: the tree is a view of the rows, and a view that silently loses rows is
 * worse than one that shows a branch in an unexpected place. The database does
 * not allow it anyway -- `parent_id` cascades -- which is why this is a
 * belt-and-braces rule rather than a case that gets exercised.
 */
function buildTree(terms: Term[]): TermNode[] {
  const nodes = new Map<string, TermNode>()
  for (const term of terms) nodes.set(term.id, { ...term, children: [] })

  const roots: TermNode[] = []
  for (const term of terms) {
    const node = nodes.get(term.id)
    if (node === undefined) continue

    const parent = term.parentId === null ? undefined : nodes.get(term.parentId)
    if (parent === undefined) roots.push(node)
    else parent.children.push(node)
  }

  return roots
}

/** Pre-order, which is the order a tree is read in and written to a list. */
function flatten(nodes: TermNode[]): Term[] {
  const out: Term[] = []

  const visit = (node: TermNode): void => {
    const { children, ...term } = node
    out.push(term)
    for (const child of children) visit(child)
  }

  for (const node of nodes) visit(node)
  return out
}

export function createTermRepository(db: DbPort): TermRepository {
  async function byId(id: string): Promise<Term | null> {
    const row = await db.first<TermRow>(`SELECT ${COLUMNS} FROM terms WHERE id = ?`, [id])
    return row === null ? null : toTerm(row)
  }

  async function selectAll(vocabularyId: string): Promise<Term[]> {
    const rows = await db.all<TermRow>(
      `SELECT ${COLUMNS} FROM terms WHERE vocabulary_id = ? ORDER BY sort_order ASC, name ASC, id ASC`,
      [vocabularyId],
    )
    return rows.map(toTerm)
  }

  async function treeOf(vocabularyId: string): Promise<TermNode[]> {
    return buildTree(await selectAll(vocabularyId))
  }

  /** Appends to the end of its siblings unless the caller picked a position. */
  async function nextSortOrder(vocabularyId: string, parentId: string | null): Promise<number> {
    // `parent_id IS ?` rather than `= ?`: `IS` compares null to null, so one
    // statement covers both a root term and a child.
    const row = await db.first<{ next: number | null }>(
      'SELECT max(sort_order) + 1 AS next FROM terms WHERE vocabulary_id = ? AND parent_id IS ?',
      [vocabularyId, parentId],
    )
    return row?.next ?? 0
  }

  /**
   * The ancestry of a term, root first and the term itself last.
   *
   * A local function as well as a repository method, because `upsert` needs it to
   * refuse a cycle and reaching it through `this` would tie the two together.
   */
  async function pathOf(id: string): Promise<Term[]> {
    const chain: Term[] = []
    let current = await byId(id)

    // The bound is a loop guard, not a depth limit: `upsert` refuses to create a
    // cycle, so a chain longer than the vocabulary is a corrupted row, and
    // walking it forever would hang a render rather than report it.
    let guard = 0
    while (current !== null && guard < 1000) {
      chain.unshift(current)
      if (current.parentId === null) break
      current = await byId(current.parentId)
      guard += 1
    }

    return chain
  }

  return {
    async list(_ctx: TenantContext, vocabularyId: string): Promise<Term[]> {
      return flatten(await treeOf(vocabularyId))
    },

    async tree(_ctx: TenantContext, vocabularyId: string): Promise<TermNode[]> {
      return treeOf(vocabularyId)
    },

    async byId(_ctx: TenantContext, id: string): Promise<Term | null> {
      return byId(id)
    },

    async path(_ctx: TenantContext, id: string): Promise<Term[]> {
      return pathOf(id)
    },

    async upsert(_ctx: TenantContext, input: TermWrite): Promise<Term> {
      const timestamp = nowIso()
      const existing = input.id === undefined ? null : await byId(input.id)
      const id = existing?.id ?? input.id ?? uuidv7()

      const vocabularyId = input.vocabularyId
      const parentId = input.parentId ?? null

      if (parentId !== null) {
        const parent = await byId(parentId)
        if (parent === null) throw new Error(`term parent ${parentId} does not exist`)
        if (parent.vocabularyId !== vocabularyId) {
          throw new Error(`term parent ${parentId} belongs to another vocabulary`)
        }

        // A term cannot be its own ancestor. This is the one invariant a
        // self-referencing table cannot state in SQL, and the reason `path`
        // exists: if the proposed parent already has this term in its ancestry,
        // the tree would stop being a tree.
        const ancestry = await pathOf(parentId)
        if (ancestry.some((term) => term.id === id)) {
          throw new Error(`term ${id} cannot be moved under its own descendant`)
        }
      }

      const name = input.name
      const slug = input.slug
      const description = input.description ?? null
      const sortOrder = input.sortOrder ?? existing?.sortOrder ?? (await nextSortOrder(vocabularyId, parentId))

      if (existing === null) {
        await db.run(
          `INSERT INTO terms (id, vocabulary_id, parent_id, name, slug, description, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, vocabularyId, parentId, name, slug, description, sortOrder, timestamp, timestamp],
        )
      } else {
        await db.run(
          `UPDATE terms SET vocabulary_id = ?, parent_id = ?, name = ?, slug = ?, description = ?, sort_order = ?, updated_at = ?
            WHERE id = ?`,
          [vocabularyId, parentId, name, slug, description, sortOrder, timestamp, id],
        )
      }

      const saved = await byId(id)
      if (saved === null) throw new Error(`term ${id} disappeared during upsert`)
      return saved
    },

    async remove(_ctx: TenantContext, id: string): Promise<boolean> {
      // Descendants and assignments follow: `terms.parent_id` and
      // `content_terms.term_id` both cascade. Deleting a branch is one statement
      // because the alternative -- a term whose parent is gone -- has no meaning.
      const changes = await db.run('DELETE FROM terms WHERE id = ?', [id])
      return changes > 0
    },

    async usage(_ctx: TenantContext, id: string): Promise<number> {
      const row = await db.first<{ total: number }>(
        'SELECT count(*) AS total FROM content_terms WHERE term_id = ?',
        [id],
      )
      return row?.total ?? 0
    },

    async usageCounts(_ctx: TenantContext): Promise<Map<string, number>> {
      const rows = await db.all<{ term_id: string; total: number }>(
        'SELECT term_id, count(*) AS total FROM content_terms GROUP BY term_id',
      )
      return new Map(rows.map((row) => [row.term_id, row.total]))
    },

    async forContent(_ctx: TenantContext, contentType: ContentType, contentId: string): Promise<Term[]> {
      const rows = await db.all<TermRow>(
        `SELECT ${QUALIFIED_COLUMNS} FROM content_terms ct
           JOIN terms t ON t.id = ct.term_id
           JOIN vocabularies v ON v.id = t.vocabulary_id
          WHERE ct.content_type = ? AND ct.content_id = ?
          ORDER BY v.sort_order ASC, v.name ASC, v.id ASC, t.sort_order ASC, t.name ASC, t.id ASC`,
        [contentType, contentId],
      )
      return rows.map(toTerm)
    },

    async assign(
      _ctx: TenantContext,
      contentType: ContentType,
      contentId: string,
      termIds: string[],
    ): Promise<void> {
      const unique = [...new Set(termIds)]

      if (unique.length > 0) {
        // The vocabulary has to say it accepts this content type. Without this
        // check the join table would accept any pair, and a product would end up
        // carrying a term the product form never offered.
        const marks = unique.map(() => '?').join(', ')
        const params: SqlParam[] = [...unique, contentType]
        const row = await db.first<{ total: number }>(
          `SELECT count(*) AS total FROM terms t
             JOIN vocabularies v ON v.id = t.vocabulary_id
            WHERE t.id IN (${marks})
              AND EXISTS (SELECT 1 FROM json_each(v.content_types) WHERE value = ?)`,
          params,
        )

        if ((row?.total ?? 0) !== unique.length) {
          throw new Error(`a term was not found, or its vocabulary does not apply to ${contentType}`)
        }
      }

      // One batch, so the content is never briefly term-less: an interrupted
      // replace would otherwise be visible to a reader that arrived between the
      // delete and the insert.
      await db.batch([
        {
          sql: 'DELETE FROM content_terms WHERE content_type = ? AND content_id = ?',
          params: [contentType, contentId],
        },
        ...unique.map((termId) => ({
          sql: 'INSERT INTO content_terms (id, content_type, content_id, term_id) VALUES (?, ?, ?, ?)',
          params: [uuidv7(), contentType, contentId, termId],
        })),
      ])
    },
  }
}
