// @vitest-environment jsdom
import type { PageResponse, PageSummary } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { PagesSection } from './pages'

const PAGES: PageSummary[] = [
  {
    id: 'page_home',
    title: 'Home',
    slug: 'home',
    status: 'published',
    isHome: true,
    sortOrder: 0,
    revision: 2,
    publishedAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'page_about',
    title: 'About',
    slug: 'about',
    status: 'draft',
    isHome: false,
    sortOrder: 1,
    revision: 1,
    publishedAt: null,
    updatedAt: '2026-02-02T00:00:00.000Z',
  },
]

function fullPage(summary: PageSummary, overrides: Partial<PageResponse> = {}): PageResponse {
  return {
    id: summary.id,
    title: summary.title,
    slug: summary.slug,
    blocks: [],
    seo: {},
    status: summary.status,
    isHome: summary.isHome,
    sortOrder: summary.sortOrder,
    revision: summary.revision,
    publishedAt: summary.publishedAt,
    createdAt: summary.updatedAt,
    updatedAt: summary.updatedAt,
    ...overrides,
  }
}

function renderSection(client: ApiClient) {
  return render(
    <MemoryRouter>
      <ApiClientProvider value={client}>
        <PagesSection />
      </ApiClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the page list', () => {
  it('shows which page is the home page', async () => {
    renderSection(
      fakeApiClient({
        async listPages() {
          return { items: PAGES, total: 2, limit: 20, offset: 0 }
        },
      }),
    )

    const homeRow = (await screen.findByRole('link', { name: 'Home' })).closest('tr')!
    expect(within(homeRow).getByTestId('home-marker').textContent).toBe('Home page')
    expect(within(homeRow).queryByRole('button', { name: 'Set as home' })).toBeNull()
  })

  it('offers the move to every other page', async () => {
    renderSection(
      fakeApiClient({
        async listPages() {
          return { items: PAGES, total: 2, limit: 20, offset: 0 }
        },
      }),
    )

    const aboutRow = (await screen.findByRole('link', { name: 'About' })).closest('tr')!
    expect(within(aboutRow).getByRole('button', { name: 'Set as home' })).toBeTruthy()
  })

  it('moves the flag and reloads, because two rows change', async () => {
    const setPageHome = vi.fn(async () => fullPage(PAGES[1]!, { isHome: true }))
    const listPages = vi.fn(async () => ({ items: PAGES, total: 2, limit: 20, offset: 0 }))
    renderSection(fakeApiClient({ setPageHome, listPages }))

    const aboutRow = (await screen.findByRole('link', { name: 'About' })).closest('tr')!
    const callsBefore = listPages.mock.calls.length
    await userEvent.click(within(aboutRow).getByRole('button', { name: 'Set as home' }))

    await waitFor(() => {
      expect(setPageHome).toHaveBeenCalledWith('page_about')
    })
    await waitFor(() => {
      expect(listPages.mock.calls.length).toBeGreaterThan(callsBefore)
    })
  })

  it('searches and filters the same way posts do', async () => {
    const listPages = vi.fn(async () => ({ items: PAGES, total: 2, limit: 20, offset: 0 }))
    renderSection(fakeApiClient({ listPages }))

    await screen.findByRole('link', { name: 'Home' })
    await userEvent.click(screen.getByRole('button', { name: 'Drafts' }))

    await waitFor(() => {
      expect(listPages).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft', offset: 0 }))
    })

    await userEvent.type(screen.getByLabelText('Search'), 'about')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(listPages).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'about' }))
    })
  })

  it('deletes once confirmed', async () => {
    const deletePage = vi.fn(async () => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSection(
      fakeApiClient({
        async listPages() {
          return { items: PAGES, total: 2, limit: 20, offset: 0 }
        },
        deletePage,
      }),
    )

    const row = (await screen.findByRole('link', { name: 'About' })).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deletePage).toHaveBeenCalledWith('page_about')
    })
  })
})
