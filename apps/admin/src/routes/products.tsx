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

/** The product list. Same shape as the other two, showing the price label. */

type LoadState = 'loading' | 'ready' | 'error'

/** Ordering a product list can ask for. */
const SORTS: readonly SortChoice[] = [
  { value: 'order:asc', key: 'order', direction: 'asc', label: 'Manual order' },
  { value: 'updated:desc', key: 'updated', direction: 'desc', label: 'Recently updated' },
  { value: 'title:asc', key: 'title', direction: 'asc', label: 'Title A–Z' },
]

export function ProductsSection() {
  const client = useApiClient()
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
      !window.confirm(
        `Delete ${String(ids.length)} product${ids.length === 1 ? '' : 's'}? This cannot be undone.`,
      )
    ) {
      return
    }

    setBulkBusy(true)
    try {
      toast.success(describeBulk(await client.bulkProducts(ids, action)))
      setSelected(new Set())
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown))
    } finally {
      setBulkBusy(false)
    }
  }

  async function toggleStatus(product: ProductSummary) {
    setBusyId(product.id)
    try {
      await client.setProductStatus(product.id, product.status === 'published' ? 'draft' : 'published')
      toast.success(product.status === 'published' ? 'Moved back to draft.' : 'Published.')
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(product: ProductSummary) {
    if (!window.confirm(`Delete “${product.title}”? This cannot be undone.`)) return

    setBusyId(product.id)
    try {
      await client.deleteProduct(product.id)
      toast.success('Product deleted.')
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE))
      else reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown))
    } finally {
      setBusyId(null)
    }
  }

  if (state === 'error') {
    return <ErrorState title="Cannot load products" description={loadError} onRetry={reload} />
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Products" description="Showcase items, with a gallery, specs and a link out.">
        <Button type="button" onClick={() => navigate('/products/new')}>
          New product
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
            placeholder="Title, slug or summary"
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
            <LoadingState label="Loading products" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search === ''
                ? 'No products yet. The first one starts with “New product”.'
                : `Nothing matches “${search}”.`}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Products</caption>
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
                    Title
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Slug
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Price
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
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
