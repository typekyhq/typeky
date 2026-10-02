import type { ProductSummary } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  PAGE_SIZE,
  PageHeader,
  Pager,
  RowActions,
  SearchBox,
  StatusFilterGroup,
  StatusText,
  type StatusFilter,
} from '@/components/list-chrome'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'

/** The product list. Same shape as the other two, showing the price label. */

type LoadState = 'loading' | 'ready' | 'error'

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

  const [attempt, setAttempt] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')

    client
      .listProducts({
        ...(filter === 'all' ? {} : { status: filter }),
        ...(search === '' ? {} : { search }),
        limit: PAGE_SIZE,
        offset,
      })
      .then(
        (result) => {
          if (cancelled) return
          setItems(result.items)
          setTotal(result.total)
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
  }, [client, filter, search, offset, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

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
