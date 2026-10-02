import { Fragment } from 'react'
import { LogOutIcon, MenuIcon } from 'lucide-react'
import { Link, useLocation } from 'react-router'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useT } from '@/lib/i18n'
import { NAVIGATION } from '@/lib/navigation'

/**
 * Breadcrumbs and the account menu.
 *
 * The breadcrumb trail is derived from the same list the sidebar renders, so a
 * section cannot be named one thing here and another there.
 */
export function AppHeader({
  actorId,
  onSignOut,
  onOpenSections,
}: {
  actorId: string
  onSignOut: () => void
  onOpenSections: () => void
}) {
  const t = useT()
  const trail = useTrail()

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6">
      <Button
        variant="outline"
        size="icon"
        className="md:hidden"
        onClick={onOpenSections}
        aria-label={t('shell.openSections')}
      >
        <MenuIcon />
      </Button>

      <Breadcrumb className="min-w-0 flex-1">
        <BreadcrumbList>
          {trail.map((crumb, index) => {
            const last = index === trail.length - 1
            // A Fragment, not a wrapper element: the list is an <ol>, and any
            // element between it and its <li> children is invalid markup.
            return (
              <Fragment key={crumb.label}>
                {index > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {last || crumb.to === undefined ? (
                    <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink asChild>
                      <Link to={crumb.to}>{crumb.label}</Link>
                    </BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </Fragment>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm">
            {actorId}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('shell.signedInAs', { actor: actorId })}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onSignOut}>
            <LogOutIcon />
            {t('shell.signOut')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}

function useTrail(): Array<{ label: string; to?: string }> {
  const { pathname } = useLocation()
  const t = useT()
  const home = t('nav.dashboard')

  const section = NAVIGATION.find((item) => item.to !== '/' && pathname.startsWith(item.to))
  if (section === undefined) return [{ label: home }]

  return [{ label: home, to: '/' }, { label: t(section.labelKey) }]
}
