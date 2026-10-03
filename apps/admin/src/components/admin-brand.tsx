import type { ReactNode } from 'react'
import { useT } from '@/lib/i18n'
import { usePanelPreference } from '@/lib/panel-preference'

/**
 * What the panel calls itself.
 *
 * The site's logo when it has one, and the platform's name when it does not --
 * which is the state a deployment starts in, and the state it stays in until
 * somebody sets a logo. Not the other way round: a delivery that has not been
 * branded yet should not look like a product page for the software it is built on.
 *
 * Sizing is by height rather than by width: logos are wordmarks of wildly different
 * aspect ratios, and constraining the height is what keeps a wide one from pushing
 * the navigation sideways.
 */
export function AdminBrand(): ReactNode {
  const t = useT()
  const { brand } = usePanelPreference()

  if (brand?.logoUrl != null) {
    return (
      <img
        src={brand.logoUrl}
        // The site's name, which is what the logo stands for. An empty alt would
        // hide the name from a screen reader that then has nothing to announce.
        alt={brand.name}
        // A fixed height and an automatic width, which is the shape a wordmark wants.
        // `self-start` because the sidebar is a flex column: without it the stretch
        // default makes the image's box as wide as the sidebar, which is invisible
        // with `object-contain` and still not what a logo is.
        //
        // `object-contain` stays as the floor: a logo wider than the sidebar is
        // letterboxed rather than stretched.
        className="h-7 w-auto max-w-full self-start object-contain"
        data-testid="admin-brand-logo"
      />
    )
  }

  return <span className="px-2 py-1 text-sm font-semibold">{t('nav.brand')}</span>
}
