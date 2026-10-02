import { API_ERROR_STATUS, type ApiErrorBody, type ApiErrorCode } from '@typeky/api'
import type { Repositories } from '@typeky/db'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import type { Env } from '../env'
import type { Session } from './session'

/**
 * Shared between the router and the individual handlers, in its own module so
 * those two do not have to import each other.
 */

export type AdminEnv = { Bindings: Env; Variables: { session: Session } }

/**
 * How a request finds its repositories; the app supplies the D1 one.
 *
 * Lives here rather than beside any one resource, because every resource
 * handler needs it and the router that wires them up needs the type.
 */
export type RepositoryResolver = (env: AdminEnv['Bindings']) => Repositories | null

/**
 * One error shape for every endpoint, with the status derived from the code so
 * the two cannot disagree.
 *
 * `message` is for the operator -- it never reaches a visitor, and the code is
 * always present so a client can branch without parsing prose.
 */
export function apiError(c: Context<AdminEnv>, code: ApiErrorCode, message?: string): Response {
  const body: ApiErrorBody = message === undefined ? { error: code } : { error: code, message }

  return c.json(body, API_ERROR_STATUS[code] as ContentfulStatusCode)
}

/** Reads a JSON body, or null if there is not one. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/**
 * Names the offending fields, which is all an authenticated operator needs.
 *
 * Shared, because every resource that validates a body owes the operator the
 * same favour: `invalid_request` on its own sends them hunting for which field.
 */
export function describeIssues(issues: ReadonlyArray<{ path: ReadonlyArray<unknown> }>): string {
  const paths = issues
    .map((issue) => issue.path.map((segment) => String(segment)).join('.'))
    .filter((path) => path !== '')

  return paths.length === 0 ? 'the request body is not valid' : `invalid fields: ${paths.join(', ')}`
}
