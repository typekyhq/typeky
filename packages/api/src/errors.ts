/**
 * The error shape every admin endpoint answers with.
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
  'admin_password_not_configured',
  'not_found',
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
  admin_password_not_configured: 503,
  not_found: 404,
  internal_error: 500,
}

export interface ApiErrorBody {
  error: ApiErrorCode
  /** Optional detail for the operator. Never rendered to a visitor verbatim. */
  message?: string
}
