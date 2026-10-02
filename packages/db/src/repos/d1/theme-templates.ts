import { nowIso, uuidv7 } from '@typeky/core'
import type { DbPort } from '@typeky/platform'
import type { TenantContext, ThemeTemplate, ThemeTemplateRepository, ThemeTemplateWrite } from '../../contracts'
import { asDate } from './support'

const DEFAULT_THEME = 'default'

const COLUMNS = ['id', 'theme', 'path', 'source', 'revision', 'updated_at'].join(', ')

interface ThemeTemplateRow {
  id: string
  theme: string
  path: string
  source: string
  revision: number
  updated_at: string
}

function toThemeTemplate(row: ThemeTemplateRow): ThemeTemplate {
  return {
    id: row.id,
    theme: row.theme,
    path: row.path,
    source: row.source,
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

    async save(_ctx: TenantContext, input: ThemeTemplateWrite): Promise<ThemeTemplate> {
      const theme = input.theme ?? DEFAULT_THEME
      const existing = await byPath(theme, input.path)
      const revision = (existing?.revision ?? 0) + 1

      if (existing === null) {
        await db.run(
          `INSERT INTO theme_templates (id, theme, path, source, revision, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
          [uuidv7(), theme, input.path, input.source, revision, nowIso()],
        )
      } else {
        await db.run(
          `UPDATE theme_templates SET source = ?, revision = ?, updated_at = ? WHERE theme = ? AND path = ?`,
          [input.source, revision, nowIso(), theme, input.path],
        )
      }

      const saved = await byPath(theme, input.path)
      if (saved === null) throw new Error(`template ${theme}/${input.path} disappeared during save`)
      return saved
    },

    async reset(_ctx: TenantContext, theme: string, path: string): Promise<boolean> {
      // Dropping the override restores the bundled baseline; there is no version
      // history to unwind, which is why the table needs no version row.
      const changes = await db.run('DELETE FROM theme_templates WHERE theme = ? AND path = ?', [theme, path])
      return changes > 0
    },
  }
}
