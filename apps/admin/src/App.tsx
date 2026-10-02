import { NavLink, Route, Routes } from 'react-router'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'

/**
 * The admin shell.
 *
 * Deliberately thin for now: routing and layout only. Navigation chrome,
 * breadcrumbs, toasts and loading states arrive with the real screens, and this
 * is the file they will grow into.
 */

const navigation: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '/', label: 'Dashboard', end: true },
]

export function App() {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-6 px-4">
          <span className="text-sm font-semibold">Typeky</span>
          <Separator orientation="vertical" className="h-5" />
          <nav className="flex items-center gap-4 text-sm">
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  isActive ? 'font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
    </div>
  )
}

function Dashboard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>The admin panel is wired up</CardTitle>
        <CardDescription>
          Sign-in, content editing and theme editing are still ahead. This page exists so the build,
          the routing and the component pipeline can be verified end to end.
        </CardDescription>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        Requests to <code>/api/admin/*</code> are served by the Worker.
      </CardContent>
    </Card>
  )
}

function NotFound() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Not found</CardTitle>
        <CardDescription>This screen does not exist yet.</CardDescription>
      </CardHeader>
    </Card>
  )
}
