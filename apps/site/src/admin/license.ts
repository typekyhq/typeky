import type { LicenseResponse } from '@typeky/api'
import type { Context } from 'hono'
import { licenseState } from '../license'
import type { AdminEnv } from './errors'

/**
 * Reading the deployment's licence from the admin.
 *
 * A read-only endpoint on purpose: a licence is bought and issued elsewhere, and
 * an endpoint that could write one would be an endpoint that could grant itself a
 * white-label licence without a key. The operator can see what was issued and
 * which domain it names; that is what makes a mis-issued key diagnosable from
 * inside the product instead of over email.
 *
 * The domain is taken from the request, exactly as the site's own rendering takes
 * it, so the admin and the public site can never disagree about whether the
 * licence applies.
 */
export async function readLicense(c: Context<AdminEnv>): Promise<Response> {
  const domain = new URL(c.req.url).host
  const state = await licenseState(c.env, domain)

  return c.json(toResponse(domain, state))
}

function toResponse(domain: string, state: Awaited<ReturnType<typeof licenseState>>): LicenseResponse {
  return {
    whiteLabel: state.whiteLabel,
    domain,
    ...(state.license === undefined ? {} : { license: state.license }),
    ...(state.problem === undefined ? {} : { problem: state.problem }),
    ...(state.licensedDomain === undefined ? {} : { licensedDomain: state.licensedDomain }),
  }
}
