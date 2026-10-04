import { siteWriteSchema, type SiteResponse } from '@typeky/api'
import { defaultContext, type Site } from '@typeky/db'
import type { Context } from 'hono'
import { apiError, describeIssues, readJsonBody, type AdminEnv, type RepositoryResolver } from './errors'
import { forgetAdminPath } from '../admin-config'

/**
 * The site document.
 *
 * One row, so the endpoints are a read and a whole-document write rather than a
 * collection. The write is a `PUT` for the same reason: what arrives is the
 * document, and anything the caller left out is cleared.
 *
 * The response is mapped field by field into the contract type rather than
 * serialising the domain object. That is what makes a divergence between the
 * repository and the wire format a compile error, and it is where the `Date`
 * columns become ISO strings.
 */

export async function readSite(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const site = await store.sites.get(defaultContext())
  if (site === null) return apiError(c, 'not_found', 'the site row has not been created yet')

  return c.json(toResponse(site))
}

export async function writeSite(c: Context<AdminEnv>, repositories: RepositoryResolver): Promise<Response> {
  const store = repositories(c.env)
  if (store === null) return apiError(c, 'database_not_configured')

  const parsed = siteWriteSchema.safeParse(await readJsonBody(c.req.raw))
  if (!parsed.success) return apiError(c, 'invalid_request', describeIssues(parsed.error.issues))

  const body = parsed.data

  // The panel's address is reserved in both directions. The page editor refuses a
  // slug that is the panel's; this is the same rule read from the other side, so an
  // operator cannot move the panel onto a URL a page already holds.
  const requested = body.settings.admin?.path
  if (typeof requested === 'string') {
    const taken = await store.pages.bySlug(defaultContext(), requested)
    if (taken !== null) {
      return apiError(c, 'slug_reserved', `the page "${taken.title}" already uses /${requested}`)
    }
  }

  // Field by field, so a new required field on the write shape is a compile
  // error here instead of silently becoming null.
  const site = await store.sites.save(defaultContext(), {
    name: body.name,
    tagline: body.tagline ?? null,
    logoMediaId: body.logoMediaId ?? null,
    faviconMediaId: body.faviconMediaId ?? null,
    theme: body.theme,
    settings: body.settings,
    nav: body.nav,
  })

  // The operator's next request should already find the panel where they just put it,
  // rather than waiting out the cache in front of the answer.
  forgetAdminPath()

  return c.json(toResponse(site))
}

function toResponse(site: Site): SiteResponse {
  return {
    name: site.name,
    tagline: site.tagline,
    logoMediaId: site.logoMediaId,
    faviconMediaId: site.faviconMediaId,
    theme: site.theme,
    settings: site.settings,
    nav: site.nav,
    updatedAt: site.updatedAt.toISOString(),
  }
}
