import { API_ERROR_STATUS, type ApiErrorBody, type ApiErrorCode } from '@typeky/api'
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
