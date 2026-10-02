import type { BulkAction, PageSummary } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  BulkBar,
  describeBulk,
  formatDate,
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
  { value: 'order:asc', key: 'order', direction: 'asc', label: 'Manual order' },
  { value: 'updated:desc', key: 'updated', direction: 'desc', label: 'Recently updated' },
  { value: 'title:asc', key: 'title', direction: 'asc', label: 'Title A–Z' },
]

export function PagesSection() {
  const client = useApiClient()
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
          setLoadError(describeApiError(thrown))
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
      !window.confirm(`Delete ${String(ids.length)} page${ids.length === 1 ? '' : 's'}? This cannot be undone.`)
    ) {
      return
    }

    setBulkBusy(true)
    try {
      toast.success(describeBulk(await client.bulkPages(ids, action)))
      setSelected(new Set())
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown))
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
      toast.error(describeApiError(thrown))
    } finally {
      setBusyId(null)
    }
  }

  async function toggleStatus(page: PageSummary) {
    setBusyId(page.id)
    try {
      await client.setPageStatus(page.id, page.status === 'published' ? 'draft' : 'published')
      toast.success(page.status === 'published' ? 'Moved back to draft.' : 'Published.')
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(page: PageSummary) {
    if (!window.confirm(`Delete “${page.title}”? This cannot be undone.`)) return

    setBusyId(page.id)
    try {
      await client.deletePage(page.id)
      toast.success('Page deleted.')
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE))
      else reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown))
    } finally {
      setBusyId(null)
    }
  }

  if (state === 'error') {
    return <ErrorState title="Cannot load pages" description={loadError} onRetry={reload} />
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pages"
        description="Standalone pages, including the one marked as the home page."
      >
        <Button type="button" onClick={() => navigate('/pages/new')}>
          New page
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
            placeholder="Title or slug"
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
            <LoadingState label="Loading pages" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search === ''
                ? 'No pages yet. The first one starts with “New page”.'
                : `Nothing matches “${search}”.`}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Pages</caption>
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
                    Title
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Slug
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
                    Order
                  </th>
                  <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
                    Updated
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
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
                          Home page
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
                      {formatDate(page.updatedAt)}
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
                              Set as home
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
