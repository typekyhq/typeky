import { nowIso, uuidv7 } from '@typeky/core'
import type { DbPort } from '@typeky/platform'
import type {
  TenantContext,
  ThemeSummary,
  ThemeTemplate,
  ThemeTemplateRepository,
  ThemeTemplateWrite,
} from '../../contracts'
import { asDate } from './support'

const DEFAULT_THEME = 'default'

const COLUMNS = ['id', 'theme', 'path', 'source', 'original_source', 'revision', 'updated_at'].join(', ')

interface ThemeTemplateRow {
  id: string
  theme: string
  path: string
  source: string
  original_source: string | null
  revision: number
  updated_at: string
}

interface ThemeSummaryRow {
  theme: string
  files: number
  updated_at: string
}

function toThemeTemplate(row: ThemeTemplateRow): ThemeTemplate {
  return {
    id: row.id,
    theme: row.theme,
    path: row.path,
    source: row.source,
    originalSource: row.original_source,
    revision: row.revision,
    updatedAt: asDate(row.updated_at),
  }
}

export function createThemeTemplateRepository(db: DbPort): ThemeTemplateRepository {
  async function byPath(theme: string, path: string): Promise<ThemeTemplate | null> {
    const row = await db.first<ThemeTemplateRow>(
      `SELECT ${COLUMNS} FROM theme_templates WHERE theme = ? AND path = ?`,
      [theme, path],
    )
    return row === null ? null : toThemeTemplate(row)
  }

  return {
    async list(_ctx: TenantContext, theme: string): Promise<ThemeTemplate[]> {
      const rows = await db.all<ThemeTemplateRow>(
        `SELECT ${COLUMNS} FROM theme_templates WHERE theme = ? ORDER BY path ASC`,
        [theme],
      )
      return rows.map(toThemeTemplate)
    },

    async byPath(_ctx: TenantContext, theme: string, path: string): Promise<ThemeTemplate | null> {
      return byPath(theme, path)
    },

    async themes(_ctx: TenantContext): Promise<ThemeSummary[]> {
      const rows = await db.all<ThemeSummaryRow>(
        'SELECT theme, COUNT(*) AS files, MAX(updated_at) AS updated_at FROM theme_templates GROUP BY theme ORDER BY theme ASC',
        [],
      )

      return rows.map((row) => ({
        name: row.theme,
        files: Number(row.files),
        updatedAt: asDate(row.updated_at),
      }))
    },

    async save(_ctx: TenantContext, input: ThemeTemplateWrite): Promise<ThemeTemplate> {
      const theme = input.theme ?? DEFAULT_THEME
      const existing = await byPath(theme, input.path)
      const revision = (existing?.revision ?? 0) + 1

      if (existing === null) {
        await db.run(
          `INSERT INTO theme_templates (id, theme, path, source, original_source, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [uuidv7(), theme, input.path, input.source, input.originalSource ?? null, revision, nowIso()],
        )
      } else {
        // `original_source` is deliberately not in this statement: an edit changes
        // what the file says, not what the theme shipped, and the undo depends on
        // the difference between them.
        await db.run(
          `UPDATE theme_templates SET source = ?, revision = ?, updated_at = ? WHERE theme = ? AND path = ?`,
          [input.source, revision, nowIso(), theme, input.path],
        )
      }

      const saved = await byPath(theme, input.path)
      if (saved === null) throw new Error(`template ${theme}/${input.path} disappeared during save`)
      return saved
    },

    async restore(_ctx: TenantContext, theme: string, path: string): Promise<boolean> {
      const row = await byPath(theme, path)
      if (row === null) return false

      if (row.originalSource === null) {
        // A bundled template: there is nothing to put back, so the override goes and
        // the baseline in code answers again.
        const changes = await db.run('DELETE FROM theme_templates WHERE theme = ? AND path = ?', [theme, path])
        return changes > 0
      }

      // An uploaded theme's file: it is put back in place rather than deleted, since
      // deleting it would take the file out of the theme as well.
      await db.run(
        'UPDATE theme_templates SET source = ?, revision = ?, updated_at = ? WHERE theme = ? AND path = ?',
        [row.originalSource, row.revision + 1, nowIso(), theme, path],
      )

      return true
    },

    async removeTheme(_ctx: TenantContext, theme: string): Promise<number> {
      return db.run('DELETE FROM theme_templates WHERE theme = ?', [theme])
    },
  }
}
