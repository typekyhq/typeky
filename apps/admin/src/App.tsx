import { type ReactNode, useState } from 'react'
import { Route, Routes } from 'react-router'
import { toast } from 'sonner'
import { AppHeader } from '@/components/app-header'
import { AppSidebar } from '@/components/app-sidebar'
import { SectionPage } from '@/components/section-page'
import { SignInScreen } from '@/components/sign-in-screen'
import { ErrorState, LoadingState } from '@/components/states'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { DashboardPage } from '@/routes/dashboard'
import { PageEditorPage } from '@/routes/page-editor'
import { PagesSection } from '@/routes/pages'
import { PostEditorPage } from '@/routes/post-editor'
import { PostsSection } from '@/routes/posts'
import { ProductEditorPage } from '@/routes/product-editor'
import { ProductsSection } from '@/routes/products'
import { MediaSection } from '@/routes/media'
import { SettingsPage } from '@/routes/settings'
import { TaxonomyPage } from '@/routes/taxonomy'
import { ThemeSection } from '@/routes/theme'
import { ApiClientProvider, useApiClient } from '@/lib/client-context'
import { apiClient } from '@/lib/client'
import type { ApiClient } from '@/lib/api-client'
import { NAVIGATION } from '@/lib/navigation'
import { useT } from '@/lib/i18n'
import { useLicense } from '@/lib/license'
import { PanelPreferenceProvider } from '@/lib/panel-preference'
import { useSession, type SessionController } from '@/lib/session'

/**
 * The admin shell.
 *
 * Four states, in the order they can happen: asking the server whether a session
 * exists, unable to ask at all, signed out, signed in. Keeping "cannot reach the
 * server" separate from "signed out" matters -- telling somebody their password
 * is wrong when the network is down is worse than saying nothing.
 */

/**
 * Sections that are built. Everything else renders the placeholder, so the
 * navigation always leads somewhere and the missing work is visible.
 */
const BUILT_SECTIONS: Record<string, ReactNode> = {
  '/': <DashboardPage />,
  '/pages': <PagesSection />,
  '/posts': <PostsSection />,
  '/products': <ProductsSection />,
  '/taxonomy': <TaxonomyPage />,
  '/media': <MediaSection />,
  '/theme': <ThemeSection />,
  '/settings': <SettingsPage />,
}

export function App({ client = apiClient }: { client?: ApiClient }) {
  const session = useSession(client)

  return (
    <ApiClientProvider value={client}>
      <Routed session={session} />
    </ApiClientProvider>
  )
}

function Routed({ session }: { session: SessionController }) {
  const t = useT()
  const { state } = session

  if (state.status === 'loading') return <LoadingScreen />

  if (state.status === 'unreachable') {
    return <UnreachableScreen message={state.message} onRetry={session.reload} />
  }

  if (state.status === 'signedOut') {
    return <SignInScreen onSubmit={session.signIn} />
  }

  return (
    /*
      The panel's own preference is read from the site document, which is behind
      the session -- so the provider mounts only once somebody is signed in. Before
      that there is no preference to read, and asking for one would be a 401 on the
      sign-in screen.
    */
    <PanelPreferenceProvider>
      <Shell
        actorId={state.session.actorId}
        onSignOut={async () => {
          try {
            await session.signOut()
          } catch {
            // The local session is already cleared; the server just did not hear
            // about it, and saying so beats pretending it worked.
            toast.error(t('shell.signedOutLocally'))
          }
        }}
      />
    </PanelPreferenceProvider>
  )
}

function Shell({ actorId, onSignOut }: { actorId: string; onSignOut: () => void }) {
  const t = useT()
  const [sectionsOpen, setSectionsOpen] = useState(false)
  // Asked once for the shell, not once per sidebar: the desktop one and the one
  // inside the mobile sheet are two mounts of the same question.
  const { whiteLabel } = useLicense(useApiClient())

  return (
    <div className="flex min-h-dvh bg-background text-foreground">
      {/* First in the tab order, invisible until focused: keyboard users should
          not have to walk the whole section list to reach the page. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        {t('shell.skipToContent')}
      </a>

      <AppSidebar className="hidden md:flex" whiteLabel={whiteLabel} />

      <Sheet open={sectionsOpen} onOpenChange={setSectionsOpen}>
        <SheetContent side="left" className="w-64 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>{t('nav.sections')}</SheetTitle>
          </SheetHeader>
          <AppSidebar className="border-e-0" onNavigate={() => setSectionsOpen(false)} whiteLabel={whiteLabel} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <AppHeader actorId={actorId} onSignOut={onSignOut} onOpenSections={() => setSectionsOpen(true)} />

        {/* tabIndex -1 so the skip link can move focus here. */}
        <main id="main" tabIndex={-1} className="flex-1 px-4 py-6 outline-none md:px-6">
          <Routes>
            {NAVIGATION.map((section) => (
              <Route
                key={section.to}
                path={section.to}
                element={BUILT_SECTIONS[section.to] ?? <SectionPage section={section} />}
              />
            ))}
            {/* Not sections: they have no place in the menu, and `/new` is the
                same screen as `/:id` with nothing loaded yet. */}
            <Route path="/posts/:id" element={<PostEditorPage />} />
            <Route path="/pages/:id" element={<PageEditorPage />} />
            <Route path="/products/:id" element={<ProductEditorPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

function LoadingScreen() {
  const t = useT()

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-6">
      <LoadingState label={t('shell.checkingSession')} className="w-full max-w-sm" />
    </main>
  )
}

function UnreachableScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useT()

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md">
        <ErrorState title={t('shell.unreachable.title')} description={message} onRetry={onRetry} />
      </div>
    </main>
  )
}

function NotFoundPage() {
  const t = useT()

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">{t('shell.notFound.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('shell.notFound.description')}</p>
    </div>
  )
}
