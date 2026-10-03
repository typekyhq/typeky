// @vitest-environment jsdom
import type { OverviewResponse, SiteResponse } from '@typeky/api'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MemoryRouter } from 'react-router'
import { ApiError, type ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { DashboardPage } from './dashboard'

/**
 * The dashboard.
 *
 * Three things a summary screen has to get right: saying how much there is, naming
 * what needs attention with a way to get to it, and being honest when there is
 * nothing rather than showing zeroes as though they were an answer.
 */

const SITE: SiteResponse = {
  name: 'Typeky Demo',
  tagline: null,
  logoMediaId: null,
  theme: 'default',
  settings: {},
  nav: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const OVERVIEW: OverviewResponse = {
  counts: {
    page: { published: 2, draft: 1 },
    post: { published: 3, draft: 0 },
    product: { published: 0, draft: 0 },
    media: 4,
  },
  drafts: [
    {
      id: 'page_about',
      kind: 'page',
      title: 'About us',
      status: 'draft',
      updatedAt: '2026-03-02T10:00:00.000Z',
      publishedAt: null,
    },
    {
      id: 'post_one',
      kind: 'post',
      title: 'Release notes',
      status: 'draft',
      updatedAt: '2026-03-01T10:00:00.000Z',
      publishedAt: null,
    },
  ],
  lastPublished: {
    id: 'post_live',
    kind: 'post',
    title: 'Hello',
    status: 'published',
    updatedAt: '2026-02-01T10:00:00.000Z',
    publishedAt: '2026-02-01T10:00:00.000Z',
  },
}

function renderDashboard(client: ApiClient) {
  return render(
    <MemoryRouter>
      <ApiClientProvider value={client}>
        <DashboardPage />
      </ApiClientProvider>
    </MemoryRouter>,
  )
}

function withOverview(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeApiClient({
    async getOverview() {
      return OVERVIEW
    },
    async getSite() {
      return SITE
    },
    ...overrides,
  })
}

describe('the dashboard', () => {
  it('says how much of each kind there is', async () => {
    renderDashboard(withOverview())

    expect((await screen.findByTestId('count-page')).textContent).toBe('Published 2 · Draft 1')
    expect(screen.getByTestId('count-post').textContent).toBe('Published 3 · Draft 0')
    expect(screen.getByTestId('count-product').textContent).toBe('Published 0 · Draft 0')
    expect(screen.getByTestId('count-media').textContent).toBe('4')
  })

  it('names the drafts, and links to the thing that edits each one', async () => {
    renderDashboard(withOverview())

    const list = await screen.findByTestId('draft-list')
    expect(within(list).getByText('About us')).toBeTruthy()
    expect(within(list).getByText('Release notes')).toBeTruthy()

    // The link is what makes a draft list worth showing: a count tells you there is
    // work, a link lets you do it.
    expect(screen.getByTestId('item-page').closest('a')?.getAttribute('href')).toBe('/pages/page_about')
  })

  it('names what went live last', async () => {
    renderDashboard(withOverview())

    expect(await screen.findByText('Hello')).toBeTruthy()
  })

  it('says nothing is waiting, rather than showing an empty list', async () => {
    renderDashboard(
      withOverview({
        async getOverview() {
          return { ...OVERVIEW, drafts: [], lastPublished: null }
        },
      }),
    )

    expect(await screen.findByText('Nothing is waiting.')).toBeTruthy()
    expect(screen.getByText('Nothing has been published yet.')).toBeTruthy()
    expect(screen.queryByTestId('draft-list')).toBeNull()
  })

  it('tells a deployment that has not been set up where to go', async () => {
    renderDashboard(
      withOverview({
        async getSite(): Promise<SiteResponse> {
          throw new ApiError('not_found', 404)
        },
      }),
    )

    // A 404 here is a state and not a failure: the first screen a new operator sees
    // should say what to do, not report an error they cannot act on.
    expect(await screen.findByText('This site has not been set up yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy()
    // The summary is still a summary: an empty site answers zeroes.
    expect(screen.getByTestId('count-page').textContent).toBe('Published 2 · Draft 1')
  })

  it('reports a real failure as one', async () => {
    renderDashboard(
      withOverview({
        async getOverview(): Promise<OverviewResponse> {
          throw new ApiError('internal_error', 500)
        },
      }),
    )

    expect(await screen.findByText('The overview could not be loaded.')).toBeTruthy()
  })
})
