import type { BulkAction, PostSummary } from '@typeky/api'
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
 * The post list.
 *
 * Filter, search and paging are all server-side, and each of the first two
 * returns to the first page: the row the operator was looking at is no longer
 * there, so keeping the offset would show an empty page.
 */

type LoadState = 'loading' | 'ready' | 'error'

/** Ordering a post list can ask for. One control holds the key and the direction. */
const SORTS: readonly SortChoice[] = [
  { value: 'published:desc', key: 'published', direction: 'desc', labelKey: 'posts.sort.newest' },
  { value: 'updated:desc', key: 'updated', direction: 'desc', labelKey: 'posts.sort.updated' },
  { value: 'created:desc', key: 'created', direction: 'desc', labelKey: 'posts.sort.created' },
  { value: 'title:asc', key: 'title', direction: 'asc', labelKey: 'posts.sort.title' },
]

export function PostsSection() {
  const t = useT()
  const client = useApiClient()
  const panel = usePanelPreference()
  const navigate = useNavigate()

  const [state, setState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [items, setItems] = useState<PostSummary[]>([])
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
      .listPosts({
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
          // A selection that survives a reload can contain rows that are no
          // longer on screen, and a bulk action would then reach rows nobody
          // can see.
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
    if (action === 'delete' && !window.confirm(t('posts.confirmDelete', { count: ids.length }))) {
      return
    }

    setBulkBusy(true)
    try {
      toast.success(describeBulk(await client.bulkPosts(ids, action), t))
      setSelected(new Set())
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBulkBusy(false)
    }
  }

  async function toggleStatus(post: PostSummary) {
    setBusyId(post.id)
    try {
      await client.setPostStatus(post.id, post.status === 'published' ? 'draft' : 'published')
      toast.success(post.status === 'published' ? t('posts.movedToDraft') : t('posts.published'))
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(post: PostSummary) {
    if (!window.confirm(t('content.confirmDeleteOne', { title: post.title }))) return

    setBusyId(post.id)
    try {
      await client.deletePost(post.id)
      toast.success(t('posts.deleted'))
      // Deleting the only row of a page would otherwise land on an empty list.
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE))
      else reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBusyId(null)
    }
  }

  if (state === 'error') {
    return <ErrorState title={t('posts.loadFailed')} description={loadError} onRetry={reload} />
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('posts.title')} description={t('posts.description')}>
        <Button type="button" onClick={() => navigate('/posts/new')}>
          {t('posts.new')}
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
            placeholder={t('posts.searchPlaceholder')}
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
            <LoadingState label={t('posts.loading')} />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search === ''
                ? t('posts.empty')
                : t('list.noMatches', { search })}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t('posts.title')}</caption>
              <thead>
                <tr className="border-b text-left">
                  <SelectionHead
                    allSelected={items.length > 0 && selected.size === items.length}
                    someSelected={selected.size > 0}
                    onChange={(next) =>
                      setSelected(next ? new Set(items.map((post) => post.id)) : new Set())
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
                    {t('content.updated')}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">{t('content.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((post) => (
                  <tr key={post.id} className="border-b align-top last:border-b-0">
                    <SelectionCell
                      label={post.title}
                      checked={selected.has(post.id)}
                      onChange={(next) =>
                        setSelected((current) => {
                          const updated = new Set(current)
                          if (next) updated.add(post.id)
                          else updated.delete(post.id)
                          return updated
                        })
                      }
                    />
                    <td className="py-3 pr-3">
                      <Link
                        to={`/posts/${post.id}`}
                        className="font-medium underline-offset-4 hover:underline focus-visible:underline"
                      >
                        {post.title}
                      </Link>
                      {post.terms.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {post.terms.map((term) => term.name).join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">{post.slug}</td>
                    <td className="py-3 pr-3">
                      <StatusText status={post.status} />
                    </td>
                    <td className="hidden py-3 pr-3 text-muted-foreground sm:table-cell">
                      {panel.format(post.updatedAt)}
                    </td>
                    <td className="py-3">
                      <RowActions
                        status={post.status}
                        busy={busyId === post.id}
                        onToggleStatus={() => toggleStatus(post)}
                        onDelete={() => remove(post)}
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
