// @vitest-environment jsdom
import type { ProductResponse } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { ProductEditorPage } from './product-editor'

/** The editor itself is tested in @typeky/editor; this is the form around it. */
vi.mock('@/components/lazy-block-editor', () => ({
  LazyBlockEditor: () => <div data-testid="block-editor" />,
}))

const PRODUCT: ProductResponse = {
  id: 'product_1',
  title: 'Desk lamp',
  slug: 'desk-lamp',
  summary: 'A lamp for a small desk',
  blocks: [],
  coverMediaId: 'media_cover',
  gallery: ['media_one', 'media_two'],
  specs: [
    { label: 'Height', value: '40 cm' },
    { label: 'Bulb', value: 'E27' },
  ],
  terms: [{ id: 'term_lamp', name: 'Lamps', slug: 'lamps' }],
  priceLabel: 'From $20',
  ctaLabel: 'Buy now',
  ctaUrl: 'https://example.com/checkout',
  seo: {},
  status: 'draft',
  sortOrder: 0,
  revision: 1,
  publishedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
}

function renderEditor(client: ApiClient, path = '/products/product_1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ApiClientProvider value={client}>
        <Routes>
          <Route path="/products/:id" element={<ProductEditorPage />} />
        </Routes>
      </ApiClientProvider>
    </MemoryRouter>,
  )
}

function loaded(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeApiClient({
    async getProduct() {
      return PRODUCT
    },
    ...overrides,
  })
}

/**
 * Opens one of the form's panels.
 *
 * Needed because a panel that is not on screen is hidden, and a hidden button
 * cannot be clicked -- by a test or by a person. Fields are a different matter:
 * typing into one works either way in jsdom, so only the tests that press a
 * button inside a panel have to come here first.
 */
async function openTab(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name }))
}

describe('opening a product', () => {
  it('fills every field, including both repeaters', async () => {
    renderEditor(loaded())

    expect(await screen.findByLabelText('Title')).toHaveProperty('value', 'Desk lamp')
    expect(screen.getByLabelText('Price')).toHaveProperty('value', 'From $20')
    expect(screen.getByLabelText('Button label')).toHaveProperty('value', 'Buy now')
    expect(screen.getByLabelText('Button link')).toHaveProperty('value', 'https://example.com/checkout')
    expect(screen.getByLabelText('Cover image')).toHaveProperty('value', 'media_cover')
    expect(screen.getByLabelText('Image 1')).toHaveProperty('value', 'media_one')
    expect(screen.getByLabelText('Image 2')).toHaveProperty('value', 'media_two')
    expect(screen.getByLabelText('Spec 1 name')).toHaveProperty('value', 'Height')
    expect(screen.getByLabelText('Spec 2 value')).toHaveProperty('value', 'E27')
  })

  it('says so when the product cannot be loaded', async () => {
    renderEditor(
      loaded({
        async getProduct(): Promise<ProductResponse> {
          throw new ApiError('not_found', 404, 'no product with that id')
        },
      }),
    )

    expect(await screen.findByText('Cannot load this product')).toBeTruthy()
  })
})

describe('the specification table', () => {
  it('adds a row and saves it', async () => {
    const saveProduct = vi.fn(async (_id: string, write: unknown) => ({
      ...PRODUCT,
      ...(write as object),
    }))
    renderEditor(loaded({ saveProduct }))

    await openTab('Specifications')
    await userEvent.click(await screen.findByRole('button', { name: 'Add specification' }))
    await userEvent.type(screen.getByLabelText('Spec 3 name'), 'Finish')
    await userEvent.type(screen.getByLabelText('Spec 3 value'), 'Brass')
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      expect(saveProduct).toHaveBeenCalledWith(
        'product_1',
        expect.objectContaining({
          specs: [
            { label: 'Height', value: '40 cm' },
            { label: 'Bulb', value: 'E27' },
            { label: 'Finish', value: 'Brass' },
          ],
        }),
      )
    })
  })

  it('stores the order the buttons show, not the order it was typed in', async () => {
    const saveProduct = vi.fn(async (_id: string, write: unknown) => ({
      ...PRODUCT,
      ...(write as object),
    }))
    renderEditor(loaded({ saveProduct }))

    await screen.findByLabelText('Spec 1 name')
    await openTab('Specifications')
    await userEvent.click(screen.getByRole('button', { name: 'Move spec 2 up' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      expect(saveProduct).toHaveBeenCalledWith(
        'product_1',
        expect.objectContaining({
          specs: [
            { label: 'Bulb', value: 'E27' },
            { label: 'Height', value: '40 cm' },
          ],
        }),
      )
    })
  })

  it('drops a half-filled row rather than refusing the save', async () => {
    const saveProduct = vi.fn(async (_id: string, write: unknown) => ({
      ...PRODUCT,
      ...(write as object),
    }))
    renderEditor(loaded({ saveProduct }))

    await openTab('Specifications')
    await userEvent.click(await screen.findByRole('button', { name: 'Add specification' }))
    await userEvent.type(screen.getByLabelText('Spec 3 name'), 'Half typed')
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      const written = saveProduct.mock.calls.at(-1)?.[1] as { specs: unknown[] }
      expect(written.specs).toHaveLength(2)
    })
  })

  it('removes a row', async () => {
    const saveProduct = vi.fn(async (_id: string, write: unknown) => ({
      ...PRODUCT,
      ...(write as object),
    }))
    renderEditor(loaded({ saveProduct }))

    await screen.findByLabelText('Spec 1 name')
    await openTab('Specifications')
    await userEvent.click(screen.getByRole('button', { name: 'Remove spec 1' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      const written = saveProduct.mock.calls.at(-1)?.[1] as { specs: unknown[] }
      expect(written.specs).toEqual([{ label: 'Bulb', value: 'E27' }])
    })
  })
})

describe('the gallery', () => {
  it('adds, reorders and saves images', async () => {
    const saveProduct = vi.fn(async (_id: string, write: unknown) => ({
      ...PRODUCT,
      ...(write as object),
    }))
    renderEditor(loaded({ saveProduct }))

    await screen.findByLabelText('Image 1')
    await openTab('Images')
    await userEvent.click(screen.getByRole('button', { name: 'Move image 2 up' }))
    await openTab('Images')
    await userEvent.click(screen.getByRole('button', { name: 'Add image' }))
    await userEvent.type(screen.getByLabelText('Image 3'), 'media_three')
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      expect(saveProduct).toHaveBeenCalledWith(
        'product_1',
        expect.objectContaining({ gallery: ['media_two', 'media_one', 'media_three'] }),
      )
    })
  })

  it('drops an empty entry rather than storing a blank id', async () => {
    const saveProduct = vi.fn(async (_id: string, write: unknown) => ({
      ...PRODUCT,
      ...(write as object),
    }))
    renderEditor(loaded({ saveProduct }))

    await screen.findByLabelText('Image 1')
    await openTab('Images')
    await userEvent.click(screen.getByRole('button', { name: 'Add image' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      const written = saveProduct.mock.calls.at(-1)?.[1] as { gallery: string[] }
      expect(written.gallery).toEqual(['media_one', 'media_two'])
    })
  })
})

describe('creating a product', () => {
  it('sends the price and the call to action', async () => {
    const createProduct = vi.fn(async (write: unknown) => ({ ...PRODUCT, ...(write as object) }))
    renderEditor(fakeApiClient({ createProduct }), '/products/new')

    await userEvent.type(await screen.findByLabelText('Title'), 'Floor lamp')
    await userEvent.type(screen.getByLabelText('Price'), 'From $99')
    await userEvent.type(screen.getByLabelText('Button label'), 'Order')
    await userEvent.type(screen.getByLabelText('Button link'), 'https://example.com/buy')
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(createProduct).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Floor lamp',
          slug: 'floor-lamp',
          priceLabel: 'From $99',
          ctaLabel: 'Order',
          ctaUrl: 'https://example.com/buy',
          status: 'published',
          // Cleared fields are null, not empty strings.
          summary: null,
          coverMediaId: null,
        }),
      )
    })
  })

  it('reports a taken slug on the field', async () => {
    const createProduct = vi.fn(async () => {
      throw new ApiError('slug_taken', 409, 'The slug "desk-lamp" is already used by "Desk lamp".')
    })
    renderEditor(fakeApiClient({ createProduct }), '/products/new')

    await userEvent.type(await screen.findByLabelText('Title'), 'Desk lamp')
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('The slug "desk-lamp" is already used by "Desk lamp".')).toBeTruthy()
    expect(screen.getByLabelText('Slug').getAttribute('aria-invalid')).toBe('true')
  })
})

describe('choosing media', () => {
  function withMedia(overrides: Partial<ApiClient> = {}): ApiClient {
    return loaded({
      async listMedia() {
        return { items: [], total: 0, limit: 24, offset: 0 }
      },
      ...overrides,
    })
  }

  it('offers the library for the cover image', async () => {
    renderEditor(withMedia())

    await screen.findByLabelText('Cover image')
    await openTab('Images')
    await userEvent.click(screen.getByRole('button', { name: 'Choose cover image' }))

    expect(await screen.findByText('Choose for cover image')).toBeTruthy()
  })

  it('adds to the gallery from the library rather than by typing an id', async () => {
    renderEditor(
      withMedia({
        async listMedia() {
          return {
            items: [
              {
                id: 'media_new',
                filename: 'extra.png',
                mimeType: 'image/png',
                byteSize: 1024,
                width: 100,
                height: 100,
                altText: null,
                createdAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            total: 1,
            limit: 24,
            offset: 0,
          }
        },
      }),
    )

    await screen.findByLabelText('Image 1')
    await openTab('Images')
    await userEvent.click(screen.getByRole('button', { name: 'Add from library' }))
    await userEvent.click(await screen.findByRole('button', { name: /extra\.png/ }))

    await waitFor(() => {
      expect(screen.getByLabelText('Image 3')).toHaveProperty('value', 'media_new')
    })
  })

  it('carries the fields no form edits through a save', async () => {
    const saveProduct = vi.fn(async (_id: string, write: unknown) => ({ ...PRODUCT, ...(write as object) }))
    renderEditor(withMedia({ saveProduct }))

    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      const written = saveProduct.mock.calls.at(-1)?.[1] as Record<string, unknown>
      expect(written.coverMediaId).toBe('media_cover')
      expect(written.seo).toEqual(PRODUCT.seo)
    })
  })
})

/**
 * The form as panels.
 *
 * A form this long is one document with one save button, and the panels only
 * decide what is on screen. That makes one behaviour essential rather than
 * nice: a save that fails has to show the panel the failure is in, or the
 * operator gets "some fields need attention" and no way to find the field.
 */
describe('the form panels', () => {
  it('opens on the fields somebody fills in first', async () => {
    renderEditor(fakeApiClient({ async getProduct() { return PRODUCT } }))

    const tablist = await screen.findByRole('tablist', { name: 'Editor sections' })

    expect(within(tablist).getByRole('tab', { selected: true }).textContent).toBe('Details')
    expect(screen.getByRole('tab', { name: 'Body', selected: false })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Specifications', selected: false })).toBeTruthy()
  })

  it('goes to the panel a failed save was about', async () => {
    // No title, so the save fails on a field that lives on the Details panel --
    // and it is pressed from the Images panel, which is the case that matters.
    renderEditor(fakeApiClient({ async getProduct() { return { ...PRODUCT, title: '' } } }))

    await openTab('Images')
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    expect(await screen.findByRole('tab', { name: 'Details', selected: true })).toBeTruthy()
  })
})
