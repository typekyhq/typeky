import * as z from 'zod/mini'

/**
 * What the panel shows before anybody has signed in.
 *
 * The site document is behind the session, so the sign-in screen has no way to read
 * the name and logo it should be showing -- which left it branded as the software
 * rather than as the site. This is that subset, and nothing else.
 *
 * It is served without a session on purpose, and that costs nothing: the name and
 * logo are already on every public page of the site, so publishing them again
 * reveals nothing that a visitor could not see.
 */
export const brandingResponseSchema = z.object({
  /** The site's name, or the platform's when the site has not been set up. */
  name: z.string(),
  /** The site's logo as a URL, or null when it has none. */
  logoUrl: z.nullable(z.string()),
})

export type BrandingResponse = z.infer<typeof brandingResponseSchema>
