/**
 * Caller identity, passed as the mandatory first argument of every repository
 * method (architecture section 5.3).
 *
 * The parameter exists even though CE has no tenant and no per-request actor
 * state. Making it mandatory now is what keeps tenant scoping a change in one
 * place when the Cloud edition arrives, instead of touching every call site.
 *
 * `tenantId` is optional rather than a constant: CE has no tenant column, and a
 * placeholder value would be noise that the compiler could not check anyway.
 */

export interface TenantContext {
  /** The site row id. Fixed to `DEFAULT_SITE_ID` in CE. */
  siteId: string
  /** Who is acting. CE has a single admin account. */
  actorId: string
  /** Cloud edition only. Stays undefined in CE. */
  tenantId?: string
}

export const DEFAULT_SITE_ID = 'default'
export const DEFAULT_ACTOR_ID = 'admin'

/** The context CE call sites pass. */
export function defaultContext(): TenantContext {
  return { siteId: DEFAULT_SITE_ID, actorId: DEFAULT_ACTOR_ID }
}
