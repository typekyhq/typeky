// @vitest-environment jsdom
import type { ProductResponse, ProductSummary } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { ProductsSection } from './products'

const PRODUCTS: ProductSummary[] = [
  {
    id: 'product_1',
    title: 'Desk lamp',
    slug: 'desk-lamp',
    summary: 'A lamp for a small desk',
    priceLabel: 'From $20',
    status: 'published',
    sortOrder: 0,
    revision: 1,
    publishedAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'product_2',
    title: 'Chair',
    slug: 'chair',
    summary: null,
    priceLabel: null,
    status: 'draft',
    sortOrder: 1,
    revision: 1,
    publishedAt: null,
    updatedAt: '2026-02-02T00:00:00.000Z',
  },
]

function fullProduct(summary: ProductSummary): ProductResponse {
  return {
    id: summary.id,
    title: summary.title,
    slug: summary.slug,
    summary: summary.summary,
    blocks: [],
    coverMediaId: null,
    gallery: [],
    specs: [],
    priceLabel: summary.priceLabel,
    ctaLabel: null,
    ctaUrl: null,
    seo: {},
    status: summary.status,
    sortOrder: summary.sortOrder,
    revision: summary.revision,
    publishedAt: summary.publishedAt,
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
  }
}

function renderSection(client: ApiClient) {
  return render(
    <MemoryRouter>
      <ApiClientProvider value={client}>
        <ProductsSection />
      </ApiClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the product list', () => {
  it('shows the price label, and a dash when there is none', async () => {
    renderSection(
      fakeApiClient({
        async listProducts() {
          return { items: PRODUCTS, total: 2, limit: 20, offset: 0 }
        },
      }),
    )

    const lampRow = (await screen.findByRole('link', { name: 'Desk lamp' })).closest('tr')!
    const chairRow = screen.getByRole('link', { name: 'Chair' }).closest('tr')!

    expect(within(lampRow).getByText('From $20')).toBeTruthy()
    expect(within(chairRow).getByText('—')).toBeTruthy()
  })

  it('searches and filters, returning to the first page', async () => {
    const listProducts = vi.fn(async () => ({ items: PRODUCTS, total: 2, limit: 20, offset: 0 }))
    renderSection(fakeApiClient({ listProducts }))

    await screen.findByRole('link', { name: 'Desk lamp' })
    await userEvent.click(screen.getByRole('button', { name: 'Drafts' }))

    await waitFor(() => {
      expect(listProducts).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'draft', offset: 0 }),
      )
    })

    await userEvent.type(screen.getByLabelText('Search'), 'lamp')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(listProducts).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'lamp' }))
    })
  })

  it('publishes and deletes from the row', async () => {
    const setProductStatus = vi.fn(async () => fullProduct(PRODUCTS[1]!))
    const deleteProduct = vi.fn(async () => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSection(
      fakeApiClient({
        async listProducts() {
          return { items: PRODUCTS, total: 2, limit: 20, offset: 0 }
        },
        setProductStatus,
        deleteProduct,
      }),
    )

    const chairRow = (await screen.findByRole('link', { name: 'Chair' })).closest('tr')!
    await userEvent.click(within(chairRow).getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(setProductStatus).toHaveBeenCalledWith('product_2', 'published')
    })

    const lampRow = screen.getByRole('link', { name: 'Desk lamp' }).closest('tr')!
    await userEvent.click(within(lampRow).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deleteProduct).toHaveBeenCalledWith('product_1')
    })
  })
})
