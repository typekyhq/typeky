import { verifyLicense, type License, type LicenseProblem } from '@typeky/core'
import type { Env } from './env'

/**
 * Whether this site is licensed to drop the attribution.
 *
 * The check is offline: no call, no cache, no failure mode where a network is
 * down and a paid site suddenly grows a badge. What it costs is a signature
 * verification, which is microseconds, and a licence that cannot be revoked --
 * which is the trade a one-off purchase makes.
 *
 * **A bad licence never breaks the site.** Every refusal is the same site with
 * the attribution on it, plus a line in the log for whoever is reading. That is
 * the acceptance criterion for this slice and it is also the right shape: an
 * operator who mistyped a key should get a working site and a message, not a
 * 500 or a locked-out deployment.
 */

export interface LicenseState {
  /** True only for a licence that verified and names this domain. */
  whiteLabel: boolean
  /** The licence, when there is a valid one. Useful to show in the admin. */
  license?: License
  /**
   * Why there is no valid licence, when a key was supplied at all.
   *
   * Absent means "no key configured", which is the ordinary state of a free
   * deployment and not something to warn about.
   */
  problem?: LicenseProblem
  /** The domain the licence names, when it named a different one. */
  licensedDomain?: string
}

/** No key, no licence. The state of a deployment that has not bought one. */
const FREE: LicenseState = { whiteLabel: false }

export async function licenseState(env: Env, domain: string): Promise<LicenseState> {
  return licenseStateFor(env.LICENSE_KEY, domain)
}

/**
 * The decision, given the token itself.
 *
 * Split out from the `env` lookup so a test can drive it with a keypair it made,
 * without the module reaching for a secret the tests must not have. The public key
 * is a parameter for the same reason and is *not* read from the environment: a
 * deployment that could supply its own would be a deployment that could license
 * itself.
 */
export async function licenseStateFor(
  token: string | undefined,
  domain: string,
  publicKey?: string,
): Promise<LicenseState> {
  if (token === undefined || token.trim() === '') return FREE

  const result = await verifyLicense(token, publicKey === undefined ? { domain } : { domain, publicKey })

  if (result.valid) return { whiteLabel: true, license: result.license }

  // Logged rather than thrown, and logged rather than hidden: the only person who
  // can act on a licence that names another domain is the operator, and this line
  // is how they find out.
  console.warn(
    `license not honoured (${result.problem})${result.detail === undefined ? '' : `: it names ${result.detail}`}`,
  )

  return {
    whiteLabel: false,
    problem: result.problem,
    ...(result.detail === undefined ? {} : { licensedDomain: result.detail }),
  }
}
