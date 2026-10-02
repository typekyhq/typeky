import type { BulkAction, ProductSummary } from '@typeky/api'
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
import { useT } from '@/lib/i18n'

/** The product list. Same shape as the other two, showing the price label. */

type LoadState = 'loading' | 'ready' | 'error'

/** Ordering a product list can ask for. */
const SORTS: readonly SortChoice[] = [
  { value: 'order:asc', key: 'order', direction: 'asc', labelKey: 'sort.manual' },
  { value: 'updated:desc', key: 'updated', direction: 'desc', labelKey: 'sort.updated' },
  { value: 'title:asc', key: 'title', direction: 'asc', labelKey: 'sort.title' },
]

export function ProductsSection() {
  const client = useApiClient()
  const t = useT()
  const navigate = useNavigate()

  const [state, setState] = useState<LoadState>('loading')
  const [loadError, setLoadError] = useState('')
  const [items, setItems] = useState<ProductSummary[]>([])
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
      .listProducts({
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
      !window.confirm(
        t('products.confirmDelete', { count: ids.length }),
      )
    ) {
      return
    }

    setBulkBusy(true)
    try {
      toast.success(describeBulk(await client.bulkProducts(ids, action), t))
      setSelected(new Set())
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBulkBusy(false)
    }
  }

  async function toggleStatus(product: ProductSummary) {
    setBusyId(product.id)
    try {
      await client.setProductStatus(product.id, product.status === 'published' ? 'draft' : 'published')
      toast.success(product.status === 'published' ? t('products.movedToDraft') : t('products.published'))
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(product: ProductSummary) {
    if (!window.confirm(t('content.confirmDeleteOne', { title: product.title }))) return

    setBusyId(product.id)
    try {
      await client.deleteProduct(product.id)
      toast.success(t('products.deleted'))
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE))
      else reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBusyId(null)
    }
  }

  if (state === 'error') {
    return <ErrorState title={t('products.loadFailed')} description={loadError} onRetry={reload} />
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Products" description={t('products.description')}>
        <Button type="button" onClick={() => navigate('/products/new')}>
          {t('products.new')}
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
            placeholder={t('products.searchPlaceholder')}
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
            <LoadingState label={t('products.loading')} />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search === ''
                ? t('products.empty')
                : `Nothing matches “${search}”.`}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">{t('products.title')}</caption>
              <thead>
                <tr className="border-b text-left">
                  <SelectionHead
                    allSelected={items.length > 0 && selected.size === items.length}
                    someSelected={selected.size > 0}
                    onChange={(next) =>
                      setSelected(next ? new Set(items.map((product) => product.id)) : new Set())
                    }
                  />
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('content.title')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('content.slug')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('content.price')}
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    {t('content.status')}
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">{t('content.actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((product) => (
                  <tr key={product.id} className="border-b align-top last:border-b-0">
                    <SelectionCell
                      label={product.title}
                      checked={selected.has(product.id)}
                      onChange={(next) =>
                        setSelected((current) => {
                          const updated = new Set(current)
                          if (next) updated.add(product.id)
                          else updated.delete(product.id)
                          return updated
                        })
                      }
                    />
                    <td className="py-3 pr-3">
                      <Link
                        to={`/products/${product.id}`}
                        className="font-medium underline-offset-4 hover:underline focus-visible:underline"
                      >
                        {product.title}
                      </Link>
                      {product.summary !== null && (
                        <p className="max-w-prose text-xs text-muted-foreground">{product.summary}</p>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">{product.slug}</td>
                    <td className="py-3 pr-3 text-muted-foreground">{product.priceLabel ?? '—'}</td>
                    <td className="py-3 pr-3">
                      <StatusText status={product.status} />
                    </td>
                    <td className="py-3">
                      <RowActions
                        status={product.status}
                        busy={busyId === product.id}
                        onToggleStatus={() => toggleStatus(product)}
                        onDelete={() => remove(product)}
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
