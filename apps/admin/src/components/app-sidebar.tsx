import { NavLink } from 'react-router'
import { PoweredBy } from '@/components/powered-by'
import { useT } from '@/lib/i18n'
import { NAVIGATION } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/**
 * The section list.
 *
 * A real `<nav>` of real links, so keyboard order, middle-click and "open in new
 * tab" all behave the way a browser user expects. The active one is marked with
 * `aria-current` by the router, not by a class alone.
 *
 * The badge sits at the bottom, pushed there by `mt-auto`, and is the only part of
 * this that a white-label licence changes.
 */
export function AppSidebar({
  className,
  onNavigate,
  whiteLabel = false,
}: {
  className?: string
  onNavigate?: () => void
  /** From the deployment's licence. Defaults to showing the badge. */
  whiteLabel?: boolean
}) {
  const t = useT()

  return (
    <nav aria-label={t('nav.sections')} className={cn('flex w-56 shrink-0 flex-col gap-1 border-r p-3', className)}>
      <span className="px-2 py-1 text-sm font-semibold">{t('nav.brand')}</span>

      {NAVIGATION.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'rounded-md px-2 py-1.5 text-sm outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
              isActive
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )
          }
        >
          {t(item.labelKey)}
        </NavLink>
      ))}

      <div className="mt-auto px-1 pt-3">
        <PoweredBy hidden={whiteLabel} />
      </div>
    </nav>
  )
}
