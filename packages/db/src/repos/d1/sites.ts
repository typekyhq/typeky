import { decodeJson, encodeJson, nowIso } from '@typeky/core'
import type { DbPort, SqlParam } from '@typeky/platform'
import { DEFAULT_SITE_ID } from '../../contracts'
import type { NavItem, Site, SiteRepository, SiteSettings, SiteWrite, TenantContext } from '../../contracts'
import { asDate } from './support'

const COLUMNS = ['id', 'name', 'tagline', 'logo_media_id', 'theme', 'settings', 'nav', 'created_at', 'updated_at'].join(
  ', ',
)

interface SiteRow {
  id: string
  name: string
  tagline: string | null
  logo_media_id: string | null
  theme: string
  settings: string
  nav: string
  created_at: string
  updated_at: string
}

function toSite(row: SiteRow): Site {
  return {
    id: row.id,
    name: row.name,
    tagline: row.tagline,
    logoMediaId: row.logo_media_id,
    theme: row.theme,
    settings: decodeJson<SiteSettings>(row.settings),
    nav: decodeJson<NavItem[]>(row.nav),
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  }
}

export function createSiteRepository(db: DbPort): SiteRepository {
  async function get(): Promise<Site | null> {
    const row = await db.first<SiteRow>(`SELECT ${COLUMNS} FROM sites WHERE id = ?`, [DEFAULT_SITE_ID])
    return row === null ? null : toSite(row)
  }

  return {
    async get(_ctx: TenantContext): Promise<Site | null> {
      return get()
    },

    async save(_ctx: TenantContext, input: SiteWrite): Promise<Site> {
      const timestamp = nowIso()
      const values: SqlParam[] = [
        input.name,
        input.tagline,
        input.logoMediaId,
        input.theme,
        encodeJson(input.settings),
        encodeJson(input.nav),
      ]

      const existing = await get()
      if (existing === null) {
        await db.run(
          `INSERT INTO sites (id, name, tagline, logo_media_id, theme, settings, nav, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [DEFAULT_SITE_ID, ...values, timestamp, timestamp],
        )
      } else {
        await db.run(
          `UPDATE sites SET name = ?, tagline = ?, logo_media_id = ?, theme = ?, settings = ?, nav = ?, updated_at = ?
           WHERE id = ?`,
          [...values, timestamp, DEFAULT_SITE_ID],
        )
      }

      const saved = await get()
      if (saved === null) throw new Error(`site ${DEFAULT_SITE_ID} disappeared during save`)
      return saved
    },
  }
}
