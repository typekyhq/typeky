import type { BulkAction, PageSummary } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  BulkBar,
  describeBulk,
  PAGE_SIZE,
  PageHeader,
  Pager,
  RowActions,
  SearchBox,
  SelectionCell,
  SelectionHead,
  SortSelect,
  StatusFilterGroup,
  StatusText,
  type SortChoice,
  type StatusFilter,
} from '@/components/list-chrome'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'
import { usePanelPreference } from '@/lib/panel-preference'
import { useT } from '@/lib/i18n'

/**
 * The page list.
 *
 * Same shape as posts, with the home page made visible in two ways: a word
 * beside the title, because "which page is my home page" is a question the list
 * should answer without opening anything, and a "Set as home" action, because
 * changing it is a move between rows rather than a field on one.
 */

type LoadState = 'loading' | 'ready' | 'error'

/** Ordering a page list can ask for. */
const SORTS: readonly SortChoice[] = [
  { value: 'order:asc', key: 'order', direction: 'asc', labelKey: 'sort.manual' },
  { value: 'updated:desc', key: 'updated', direction: 'desc', labelKey: 'sort.updated' },
  { value: 'title:asc', key: 'title', direction: 'asc', labelKey: 'sort.title' },
]

export function PagesSection() {
  const t = useT()
  const client = useApiClient()
  const panel = usePanelPreference()
  const navigate = useNavigate()

  const [state, setState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [items, setItems] = useState<PageSummary[]>([])
  const [total, setTotal] = useState(0)

  const [filter, setFilter] = useState<StatusFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [sort, setSort] = useState<SortChoice>(SORTS[0]!)

  const [attempt, setAttempt] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState('loading')

    client
      .listPages({
        ...(filter === 'all' ? {} : { status: filter }),
        ...(search === '' ? {} : { search }),
        sort: sort.key,
        direction: sort.direction,
        limit: PAGE_SIZE,
        offset,
      })
      .then(
        (result) => {
          if (cancelled) return
          setItems(result.items)
          setTotal(result.total)
          setSelected(new Set())
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
  }, [client, filter, search, sort, offset, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  async function runBulk(action: BulkAction) {
    const ids = [...selected]
    if (ids.length === 0) return
    if (
      action === 'delete' &&
      !window.confirm(t('pages.confirmDelete', { count: ids.length }))
    ) {
      return
    }

    setBulkBusy(true)
    try {
      toast.success(describeBulk(await client.bulkPages(ids, action), t))
      setSelected(new Set())
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBulkBusy(false)
    }
  }

  async function makeHome(page: PageSummary) {
    setBusyId(page.id)
    try {
      await client.setPageHome(page.id)
      toast.success(`“${page.title}” is now the home page.`)
      // Two rows change, so the list is reloaded rather than patched.
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBusyId(null)
    }
  }

  async function toggleStatus(page: PageSummary) {
    setBusyId(page.id)
    try {
      await client.setPageStatus(page.id, page.status === 'published' ? 'draft' : 'published')
      toast.success(page.status === 'published' ? t('pages.movedToDraft') : t('pages.published'))
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(page: PageSummary) {
    if (!window.confirm(t('content.confirmDeleteOne', { title: page.title }))) return

    setBusyId(page.id)
    try {
      await client.deletePage(page.id)
      toast.success(t('pages.deleted'))
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE))
      else reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBusyId(null)
    }
  }

  if (state === 'error') {
    return <ErrorState title={t('pages.loadFailed')} description={loadError} onRetry={reload} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pages.title')}
        description={t('pages.description')}
      >
        <Button type="button" onClick={() => navigate('/pages/new')}>
          {t('pages.new')}
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <StatusFilterGroup
          value={filter}
          onChange={(next) => {
            setFilter(next)
            setOffset(0)
          }}
        />
        <div className="flex flex-wrap items-end gap-2">
          <SortSelect
            choices={SORTS}
            value={sort.value}
            onChange={(next) => {
              setSort(next)
              setOffset(0)
            }}
          />
          <SearchBox
            value={searchInput}
            onChange={setSearchInput}
            placeholder={t('pages.searchPlaceholder')}
            onSubmit={() => {
              setSearch(searchInput.trim())
              setOffset(0)
            }}
          />
        </div>
      </div>

      <BulkBar
        count={selected.size}
        busy={bulkBusy}
        onPublish={() => void runBulk('publish')}
        onDraft={() => void runBulk('draft')}
        onDelete={() => void runBulk('delete')}
        onClear={() => setSelected(new Set())}
      />

      <Card>
        <CardContent>
          {state === 'loading' && items.length === 0 ? (
            <LoadingState label={t('pages.loading')} />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search === ''
                ? t('pages.empty')
                : t('list.noMatches', { search })}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t('pages.title')}</caption>
              <thead>
                <tr className="border-b text-left">
                  <SelectionHead
                    allSelected={items.length > 0 && selected.size === items.length}
                    someSelected={selected.size > 0}
                    onChange={(next) =>
                      setSelected(next ? new Set(items.map((page) => page.id)) : new Set())
                    }
                  />
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('content.title')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('content.slug')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('content.status')}
                  </th>
                  <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
                    {t('content.order')}
                  </th>
                  <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
                    {t('content.updated')}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">{t('content.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((page) => (
                  <tr key={page.id} className="border-b align-top last:border-b-0">
                    <SelectionCell
                      label={page.title}
                      checked={selected.has(page.id)}
                      onChange={(next) =>
                        setSelected((current) => {
                          const updated = new Set(current)
                          if (next) updated.add(page.id)
                          else updated.delete(page.id)
                          return updated
                        })
                      }
                    />
                    <td className="py-3 pr-3">
                      <Link
                        to={`/pages/${page.id}`}
                        className="font-medium underline-offset-4 hover:underline focus-visible:underline"
                      >
                        {page.title}
                      </Link>
                      {page.isHome && (
                        <p className="text-xs text-muted-foreground" data-testid="home-marker">
                          {t('pages.homeMarker')}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">{page.slug}</td>
                    <td className="py-3 pr-3">
                      <StatusText status={page.status} />
                    </td>
                    <td className="hidden py-3 pr-3 text-muted-foreground sm:table-cell">
                      {page.sortOrder}
                    </td>
                    <td className="hidden py-3 pr-3 text-muted-foreground sm:table-cell">
                      {panel.format(page.updatedAt)}
                    </td>
                    <td className="py-3">
                      <RowActions
                        status={page.status}
                        busy={busyId === page.id}
                        onToggleStatus={() => toggleStatus(page)}
                        onDelete={() => remove(page)}
                        extra={
                          page.isHome ? null : (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busyId === page.id}
                              onClick={() => makeHome(page)}
                            >
                              {t('pages.setAsHome')}
                            </Button>
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <Pager total={total} offset={offset} shown={items.length} onOffset={setOffset} />
        </CardContent>
      </Card>
    </div>
  )
}
