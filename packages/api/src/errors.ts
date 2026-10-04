import * as z from 'zod/mini'

/**
 * The error shape every admin endpoint answers with.
 *
 * `zod/mini` rather than `zod`: the classic entry attaches `toJSONSchema()` to
 * every schema instance, so the whole JSON-Schema machinery plus every locale
 * ships with it and cannot be tree-shaken -- 91 KiB gzipped against 4.5 KiB
 * here, for the same three schemas. This package is imported by both the site
 * Worker and the admin SPA, so that difference is paid twice.
 *
 * A closed set of codes rather than free-form strings: the admin SPA switches on
 * them, so a typo in a handler should be a type error here rather than a
 * response the client silently fails to recognise.
 */

export const API_ERROR_CODES = [
  'invalid_request',
  'unauthorized',
  'csrf_failed',
  'invalid_credentials',
  /** The client has spent its attempts for the window; see `login-attempts.ts`. */
  'too_many_attempts',
  'admin_password_not_configured',
  'database_not_configured',
  'not_found',
  /** The content's slug is already in use, so the URL would be ambiguous. */
  'slug_taken',
  /** A vocabulary with that name exists; two would be indistinguishable. */
  'name_taken',
  /** The slug is one the platform -- or the operator -- has reserved for itself. */
  'slug_reserved',
  /** No bucket is bound, so uploads and media reads cannot be served. */
  'storage_not_configured',
  'internal_error',
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

/**
 * Status for each code, kept beside the codes so a handler cannot return one
 * with the other's status.
 */
export const API_ERROR_STATUS: Record<ApiErrorCode, number> = {
  invalid_request: 400,
  unauthorized: 401,
  csrf_failed: 403,
  invalid_credentials: 401,
  too_many_attempts: 429,
  admin_password_not_configured: 503,
  database_not_configured: 503,
  not_found: 404,
  slug_taken: 409,
  name_taken: 409,
  slug_reserved: 409,
  storage_not_configured: 503,
  internal_error: 500,
}

export const apiErrorBodySchema = z.object({
  error: z.enum(API_ERROR_CODES),
  /** Optional detail for the operator. Never rendered to a visitor verbatim. */
  message: z.optional(z.string()),
  /**
   * Where the server could locate the problem, 1-based.
   *
   * Only set when a handler can point at a place in something the operator sent
   * -- a template that will not parse is the case it exists for. Absent means
   * "no better answer than the message", which is not the same as line 0.
   */
  line: z.optional(z.number()),
})

export type ApiErrorBody = z.infer<typeof apiErrorBodySchema>
