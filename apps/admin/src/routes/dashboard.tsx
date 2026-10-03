import type { OverviewItem, OverviewKind, OverviewResponse, SiteResponse } from '@typeky/api'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ErrorState, LoadingState } from '@/components/states'
import { ApiError } from '@/lib/api-client'
import { useApiClient } from '@/lib/client-context'
import { useT } from '@/lib/i18n'
import { usePanelPreference } from '@/lib/panel-preference'
import { describeApiError } from '@/lib/session'

/**
 * The dashboard.
 *
 * What the navigation promised: how much content there is, the drafts worth looking
 * at, and what went live last. All of it in one request, because four numbers
 * should not cost four round trips.
 *
 * The one thing it does beyond that is the state a new deployment is in: with no
 * site document there is nothing to summarise, and the screen says so and points at
 * the settings rather than showing four zeroes as if that were an answer.
 */

type LoadState = 'loading' | 'ready' | 'error'

/** Where each kind lives, so one row can link to the thing it is about. */
const LISTS: Record<OverviewKind, string> = { page: '/pages', post: '/posts', product: '/products' }
const COUNTS: ReadonlyArray<{ kind: OverviewKind; labelKey: string }> = [
  { kind: 'page', labelKey: 'nav.pages' },
  { kind: 'post', labelKey: 'nav.posts' },
  { kind: 'product', labelKey: 'nav.products' },
]

export function DashboardPage(): ReactNode {
  const client = useApiClient()
  const t = useT()
  const panel = usePanelPreference()

  const [state, setState] = useState<LoadState>('loading')
  const [overview, setOverview] = useState<OverviewResponse | null>(null)
  /** Null when the site has no document yet, which is a state and not an error. */
  const [site, setSite] = useState<SiteResponse | null>(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')

    const overview = client.getOverview()
    // A deployment that has never been set up answers 404 here, and that is the
    // first thing a new operator should be told rather than an error page.
    const site = client.getSite().catch((thrown: unknown) => {
      if (thrown instanceof ApiError && thrown.code === 'not_found') return null
      throw thrown
    })

    Promise.all([overview, site]).then(
      ([loadedOverview, loadedSite]) => {
        if (cancelled) return
        setOverview(loadedOverview)
        setSite(loadedSite)
        setState('ready')
      },
      (thrown: unknown) => {
        if (cancelled) return
        setLoadError(describeApiError(thrown, t))
        setState('error')
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, t])

  if (state === 'error') {
    return <ErrorState title={t('dashboard.loadFailed')} description={loadError} />
  }

  if (state === 'loading' || overview === null) {
    return <LoadingState label={t('dashboard.loading')} />
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t('nav.dashboard')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{t('nav.dashboard.description')}</p>
      </div>

      {site === null && (
        <Alert>
          <AlertTitle>{t('dashboard.setUp.title')}</AlertTitle>
          <AlertDescription>
            {t('dashboard.setUp.description')}{' '}
            <Link to="/settings" className="underline">
              {t('nav.settings')}
            </Link>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.content')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {COUNTS.map(({ kind, labelKey }) => {
              const counted = overview.counts[kind]

              return (
                <div key={kind} className="flex items-baseline justify-between gap-4">
                  <Link to={LISTS[kind]} className="underline-offset-4 hover:underline">
                    {t(labelKey)}
                  </Link>
                  <span className="text-sm text-muted-foreground" data-testid={`count-${kind}`}>
                    {t('common.published')} {counted.published} · {t('common.draft')} {counted.draft}
                  </span>
                </div>
              )
            })}

            <div className="flex items-baseline justify-between gap-4">
              <Link to="/media" className="underline-offset-4 hover:underline">
                {t('nav.media')}
              </Link>
              <span className="text-sm text-muted-foreground" data-testid="count-media">
                {overview.counts.media}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.lastPublished')}</CardTitle>
          </CardHeader>
          <CardContent>
            {overview.lastPublished === null ? (
              <p className="text-sm text-muted-foreground">{t('dashboard.neverPublished')}</p>
            ) : (
              <p className="space-x-2">
                <ItemLink item={overview.lastPublished} />
                <span className="text-sm text-muted-foreground">
                  {panel.format(overview.lastPublished.publishedAt ?? '')}
                </span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.drafts')}</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.drafts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('dashboard.noDrafts')}</p>
          ) : (
            <ul className="divide-y" data-testid="draft-list">
              {overview.drafts.map((item) => (
                <li key={`${item.kind}:${item.id}`} className="flex items-baseline justify-between gap-4 py-2">
                  <ItemLink item={item} />
                  <span className="shrink-0 text-sm text-muted-foreground">
                    {t('dashboard.updatedAt', { when: panel.format(item.updatedAt) })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

/** The title, linking to whatever edits it, with what it is beside it. */
function ItemLink({ item }: { item: OverviewItem }): ReactNode {
  const t = useT()

  const label =
    item.kind === 'page' ? t('nav.pages') : item.kind === 'post' ? t('nav.posts') : t('nav.products')

  return (
    <span className="min-w-0">
      <Link
        to={`${LISTS[item.kind]}/${item.id}`}
        className="underline-offset-4 hover:underline"
        data-testid={`item-${item.kind}`}
      >
        {item.title}
      </Link>
      <span className="ml-2 text-xs text-muted-foreground">{label}</span>
    </span>
  )
}
