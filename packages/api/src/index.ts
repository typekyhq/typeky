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

export {
  getBlockSchema,
  getBlocksSchema,
  parseBlocks,
  safeParseBlocks,
  type BlockSchema,
  type BlocksSchema,
} from './blocks'

export {
  CONTENT_SLUG_PATTERN,
  contentSlugSchema,
  contentStatusSchema,
  seoMetadataSchema,
  type ContentStatus,
  type SeoMetadata,
} from './content'

export {
  DEFAULT_POST_STATUS,
  getPostListResponseSchema,
  getPostResponseSchema,
  getPostSummarySchema,
  getPostWriteSchema,
  postStatusRequestSchema,
  type PostListResponse,
  type PostResponse,
  type PostSummary,
  type PostWrite,
} from './posts'

export {
  getPageListResponseSchema,
  getPageResponseSchema,
  getPageSummarySchema,
  getPageWriteSchema,
  type PageListResponse,
  type PageResponse,
  type PageSummary,
  type PageWrite,
} from './pages'

export {
  navItemSchema,
  siteResponseSchema,
  siteSettingsSchema,
  siteWriteSchema,
  socialLinkSchema,
  type NavItem,
  type SiteResponse,
  type SiteSettings,
  type SiteWrite,
  type SocialLink,
} from './site'
