import { NavLink } from 'react-router'
import { NAVIGATION } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/**
 * The section list.
 *
 * A real `<nav>` of real links, so keyboard order, middle-click and "open in new
 * tab" all behave the way a browser user expects. The active one is marked with
 * `aria-current` by the router, not by a class alone.
 */
export function AppSidebar({
  className,
  onNavigate,
}: {
  className?: string
  onNavigate?: () => void
}) {
  return (
    <nav aria-label="Sections" className={cn('flex w-56 shrink-0 flex-col gap-1 border-r p-3', className)}>
      <span className="px-2 py-1 text-sm font-semibold">Typeky</span>

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
          {item.label}
        </NavLink>
      ))}
    </nav>
  )
}
