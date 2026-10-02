import { ATTRIBUTION } from '@typeky/core'

/**
 * The platform's badge, in the admin.
 *
 * Rendered from the same constant the site's templates get, so the front and back
 * cannot drift into saying different things. The link is `rel="noopener"` and
 * deliberately not `nofollow` -- see `packages/core/src/attribution.ts` for why
 * the distinction matters.
 *
 * `hidden` is passed rather than the component not being rendered, so the choice
 * is one prop at one call site instead of a conditional in the layout: when a
 * licence arrives, this is the line that changes.
 */
export function PoweredBy({ hidden = false }: { hidden?: boolean }) {
  if (hidden) return null

  return (
    <a
      data-typeky-attribution
      href={ATTRIBUTION.url}
      rel="noopener"
      className="rounded-md px-2 py-1 text-xs text-muted-foreground underline underline-offset-2 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      {ATTRIBUTION.text}
    </a>
  )
}
