/**
 * @typeky/api -- Admin JSON API contract (Zod schemas and types)
 *
 * Layout and responsibilities: CONTRIBUTING.md section 6
 * Architecture red lines: CONTRIBUTING.md section 3
 *
 * Schemas live here rather than beside their handlers so the server and the
 * admin SPA cannot drift onto different shapes: the server parses with them, the
 * client infers from them.
 */

export {
  API_ERROR_CODES,
  API_ERROR_STATUS,
  apiErrorBodySchema,
  type ApiErrorBody,
  type ApiErrorCode,
} from './errors'

export {
  CSRF_HEADER,
  loginRequestSchema,
  sessionSchema,
  type LoginRequest,
  type Session,
} from './session'
