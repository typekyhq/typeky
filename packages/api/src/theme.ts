import * as z from 'zod/mini'

/**
 * The theme's templates.
 *
 * Only names the theme ships may be read or written, so the baseline is the
 * whole set: an override cannot introduce a template that is not already there
 * (architecture red line 8), which is why nothing here takes a path the caller
 * invented. The admin lists what exists and edits what it lists.
 */

export const THEME_TEMPLATE_GROUPS = ['layouts', 'templates', 'snippets'] as const

export type ThemeTemplateGroup = (typeof THEME_TEMPLATE_GROUPS)[number]

export const themeTemplateSummarySchema = z.object({
  /** Normalised name, for example `templates/post`. */
  path: z.string(),
  group: z.enum(THEME_TEMPLATE_GROUPS),
  /** True when the site has its own copy rather than the bundled one. */
  overridden: z.boolean(),
  /** Size of what is currently in force, so the list can show it. */
  bytes: z.number(),
  updatedAt: z.nullable(z.string()),
})

export type ThemeTemplateSummary = z.infer<typeof themeTemplateSummarySchema>

export const themeTemplateListResponseSchema = z.object({
  theme: z.string(),
  items: z.array(themeTemplateSummarySchema),
})

export type ThemeTemplateListResponse = z.infer<typeof themeTemplateListResponseSchema>

export const themeTemplateResponseSchema = z.object({
  path: z.string(),
  /** In force now: the override if there is one, otherwise the bundled source. */
  source: z.string(),
  overridden: z.boolean(),
  updatedAt: z.nullable(z.string()),
})

export type ThemeTemplateResponse = z.infer<typeof themeTemplateResponseSchema>

/**
 * A template being saved.
 *
 * The name is not a path the caller invented: the server checks it against what
 * the theme ships before it does anything else, and refuses anything else.
 */
export const themeTemplateWriteSchema = z.object({
  path: z.string().check(z.minLength(1), z.maxLength(200)),
  source: z.string().check(z.minLength(1), z.maxLength(64 * 1024)),
})

export type ThemeTemplateWrite = z.infer<typeof themeTemplateWriteSchema>
