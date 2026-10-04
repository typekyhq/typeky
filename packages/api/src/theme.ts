import * as z from 'zod/mini'

/**
 * The themes a deployment can serve, and the act of adding one.
 *
 * A theme is a set of text files: templates the renderer reads and assets the
 * browser fetches. Uploading is how a theme that did not ship in code gets here --
 * the bundled one is always present and cannot be replaced, which is why its name is
 * refused as an upload target.
 */

/** One theme in the list the settings screen and the theme page share. */
export const themeSummarySchema = z.object({
  name: z.string(),
  /** Templates and assets together. */
  files: z.number(),
  updatedAt: z.nullable(z.string()),
  /** True for the theme that ships in code. It cannot be removed. */
  bundled: z.boolean(),
})

export type ThemeSummary = z.infer<typeof themeSummarySchema>

export const themeListResponseSchema = z.object({
  themes: z.array(themeSummarySchema),
  /** The theme the site is serving, which is the one the editor edits. */
  active: z.string(),
})

export type ThemeListResponse = z.infer<typeof themeListResponseSchema>

/**
 * One file of an uploaded theme.
 *
 * The path is relative to the theme root (`templates/post`, `assets/theme.css`) and
 * is the only thing that says what the file is for. Both halves of that are checked
 * where it lands, not here: this is a shape, and the shape of a path is not what
 * makes it safe.
 */
export const themeFileSchema = z.object({
  path: z.string().check(z.minLength(1), z.maxLength(200)),
  source: z.string().check(z.minLength(1), z.maxLength(64 * 1024)),
})

/**
 * A theme being uploaded.
 *
 * The limits are the loader's, checked here so an oversized theme is refused before
 * anything is written rather than when it is first rendered: at most 200 files and
 * at most 1,000,000 characters of source, which is the same ceiling the overrides
 * live under.
 */
export const themeUploadSchema = z.object({
  name: z
    .string()
    .check(
      z.regex(/^[a-z0-9][a-z0-9-]{1,59}$/, 'lower-case letters, digits and hyphens'),
      z.refine((value: string) => value !== 'default', 'the bundled theme cannot be replaced'),
    ),
  files: z
    .array(themeFileSchema)
    .check(
      z.minLength(1),
      z.maxLength(200),
      z.refine(
        (files: { path: string; source: string }[]) =>
          files.reduce((total, file) => total + file.source.length, 0) <= 1_000_000,
        'the theme is larger than 1,000,000 characters of source',
      ),
    ),
})

export type ThemeUpload = z.infer<typeof themeUploadSchema>

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

/**
 * A template being previewed.
 *
 * Same shape as a write, and deliberately so: a preview is what a save would
 * look like, and anything that could be saved should be previewable.
 */
/**
 * The paths a template may read, taken from a real render context.
 *
 * Paths rather than a shape: `content.terms` is either there or it is not, and an
 * object of example values would invite an author to read the example instead of
 * the contract.
 */
export const themeContextResponseSchema = z.object({
  /** The template the paths were derived from, echoed back. */
  template: z.string(),
  /** Sorted, for example `content.title`. */
  paths: z.array(z.string()),
  /** The Liquid tags the sandbox allows -- the whitelist itself, not a summary. */
  tags: z.array(z.string()),
  /** The filters this platform adds, which are the ones worth naming. */
  platformFilters: z.array(z.string()),
  /** Liquid's own filters the sandbox keeps, so the list is complete. */
  nativeFilters: z.array(z.string()),
})

export type ThemeContextResponse = z.infer<typeof themeContextResponseSchema>

export const themePreviewResponseSchema = z.object({
  /** The rendered page, as a string for an `srcdoc` frame. */
  html: z.string(),
  /** Rendered bytes, so the admin can say when a page is enormous. */
  bytes: z.number(),
})

export type ThemePreviewResponse = z.infer<typeof themePreviewResponseSchema>
