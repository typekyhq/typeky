import { API_ERROR_STATUS, type ApiErrorBody, type ApiErrorCode } from '@typeky/api'
import type { Repositories } from '@typeky/db'
import type { BlobPort } from '@typeky/platform'
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
 * How a request finds blob storage; the app supplies the R2 one.
 *
 * Separate from the repositories because the two can be configured apart: a
 * deployment may have a database and no bucket, which is a state the media
 * endpoints have to report rather than trip over.
 */
export type BlobResolver = (env: AdminEnv['Bindings']) => BlobPort | null

/**
 * One error shape for every endpoint, with the status derived from the code so
 * the two cannot disagree.
 *
 * `message` is for the operator -- it never reaches a visitor, and the code is
 * always present so a client can branch without parsing prose.
 */
export function apiError(
  c: Context<AdminEnv>,
  code: ApiErrorCode,
  message?: string,
  /** Where the problem is, when the handler can point at it. */
  line?: number,
): Response {
  const body: ApiErrorBody = {
    error: code,
    ...(message === undefined ? {} : { message }),
    ...(line === undefined ? {} : { line }),
  }

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

/**
 * Whether a write failed against a unique index.
 *
 * SQLite reports the violation in the message. Matching on text is unpleasant,
 * but the alternative is letting the one race an operator can cause by hand --
 * two tabs saving the same slug -- surface as an internal error.
 *
 * Shared, because posts, pages, products and terms all have a unique column and
 * all four owe the operator the same answer.
 */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message)
}
