// @vitest-environment jsdom
import type { PostResponse, PostSummary } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { describeBulk } from '@/components/list-chrome'
import { createTranslator } from '@/lib/i18n'
import { PostsSection } from './posts'

const POSTS: PostSummary[] = [
  {
    id: 'post_1',
    title: 'Release notes',
    slug: 'release-notes',
    excerpt: 'What changed',
    terms: [{ id: 'term_news', name: 'News', slug: 'news' }],
    tags: ['release'],
    status: 'published',
    revision: 3,
    publishedAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
  {
    id: 'post_2',
    title: 'Release plan',
    slug: 'release-plan',
    excerpt: null,
    terms: [],
    tags: [],
    status: 'draft',
    revision: 1,
    publishedAt: null,
    updatedAt: '2026-02-02T00:00:00.000Z',
  },
]

/** The list answers with summaries; the status action answers with the whole post. */
function fullPost(summary: PostSummary, status: PostResponse['status']): PostResponse {
  return {
    ...summary,
    coverMediaId: null,
    blocks: [],
    seo: {},
    status,
    createdAt: summary.updatedAt,
  }
}

function renderSection(client: ApiClient) {  return render(
    <MemoryRouter>
      <ApiClientProvider value={client}>
        <PostsSection />
      </ApiClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('the post list', () => {
  it('shows what the server has', async () => {
    renderSection(
      fakeApiClient({
        async listPosts() {
          return { items: POSTS, total: 2, limit: 20, offset: 0 }
        },
      }),
    )

    expect(await screen.findByRole('link', { name: 'Release notes' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Release plan' })).toBeTruthy()
    expect(screen.getByTestId('content-count').textContent).toBe('1–2 of 2')
  })

  it('asks for a status filter and returns to the first page', async () => {
    const listPosts = vi.fn(async () => ({ items: POSTS, total: 40, limit: 20, offset: 20 }))
    renderSection(fakeApiClient({ listPosts }))

    await screen.findByRole('link', { name: 'Release notes' })
    await userEvent.click(screen.getByRole('button', { name: 'Drafts' }))

    await waitFor(() => {
      expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'draft', offset: 0 }))
    })
  })

  it('searches on submit rather than on every keystroke', async () => {
    const listPosts = vi.fn(async () => ({ items: POSTS, total: 2, limit: 20, offset: 0 }))
    renderSection(fakeApiClient({ listPosts }))

    await screen.findByRole('link', { name: 'Release notes' })
    const callsBefore = listPosts.mock.calls.length

    await userEvent.type(screen.getByLabelText('Search'), 'release')
    expect(listPosts.mock.calls.length).toBe(callsBefore)

    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'release', offset: 0 }))
    })
  })

  it('pages forward and back', async () => {
    const listPosts = vi.fn(async (query?: { offset?: number }) => ({
      items: POSTS,
      total: 40,
      limit: 20,
      offset: query?.offset ?? 0,
    }))
    renderSection(fakeApiClient({ listPosts }))

    await screen.findByRole('link', { name: 'Release notes' })
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))

    await waitFor(() => {
      expect(listPosts).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 20 }))
    })
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', false)
  })

  it('publishes a draft without opening it', async () => {
    const setPostStatus = vi.fn(async () => fullPost(POSTS[1]!, 'published'))
    renderSection(
      fakeApiClient({
        async listPosts() {
          return { items: POSTS, total: 2, limit: 20, offset: 0 }
        },
        setPostStatus,
      }),
    )

    await screen.findByRole('link', { name: 'Release notes' })
    const draftRow = screen.getByRole('link', { name: 'Release plan' }).closest('tr')!
    await userEvent.click(within(draftRow).getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(setPostStatus).toHaveBeenCalledWith('post_2', 'published')
    })
  })

  it('asks before deleting, and does not delete when told no', async () => {
    const deletePost = vi.fn(async () => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderSection(
      fakeApiClient({
        async listPosts() {
          return { items: POSTS, total: 2, limit: 20, offset: 0 }
        },
        deletePost,
      }),
    )

    await screen.findByRole('link', { name: 'Release notes' })
    const row = screen.getByRole('link', { name: 'Release notes' }).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(deletePost).not.toHaveBeenCalled()
  })

  it('deletes once confirmed', async () => {
    const deletePost = vi.fn(async () => undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSection(
      fakeApiClient({
        async listPosts() {
          return { items: POSTS, total: 2, limit: 20, offset: 0 }
        },
        deletePost,
      }),
    )

    await screen.findByRole('link', { name: 'Release notes' })
    const row = screen.getByRole('link', { name: 'Release notes' }).closest('tr')!
    await userEvent.click(within(row).getByRole('button', { name: 'Delete' }))

    await waitFor(() => {
      expect(deletePost).toHaveBeenCalledWith('post_1')
    })
  })

  it('says nothing matched rather than showing an empty table', async () => {
    renderSection(
      fakeApiClient({
        async listPosts() {
          return { items: [], total: 0, limit: 20, offset: 0 }
        },
      }),
    )

    await userEvent.type(screen.getByLabelText('Search'), 'nothing')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('Nothing matches “nothing”.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
})

describe('sorting the list', () => {
  it('asks for the ordering that was chosen, from the first page', async () => {
    const listPosts = vi.fn(async () => ({ items: POSTS, total: 40, limit: 20, offset: 0 }))
    renderSection(fakeApiClient({ listPosts }))

    await screen.findByRole('link', { name: 'Release notes' })
    await userEvent.selectOptions(screen.getByLabelText('Sort'), 'title:asc')

    await waitFor(() => {
      expect(listPosts).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'title', direction: 'asc', offset: 0 }),
      )
    })
  })
})

describe('acting on a selection', () => {
  function withPosts(overrides: Partial<ApiClient> = {}): ApiClient {
    return fakeApiClient({
      async listPosts() {
        return { items: POSTS, total: 2, limit: 20, offset: 0 }
      },
      ...overrides,
    })
  }

  it('shows the bulk bar only once something is selected', async () => {
    renderSection(withPosts())

    await screen.findByRole('link', { name: 'Release notes' })
    expect(screen.queryByTestId('bulk-bar')).toBeNull()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Release notes' }))

    expect(screen.getByTestId('bulk-bar').textContent).toContain('1 selected')
  })

  it('selects the whole page from the header', async () => {
    renderSection(withPosts())

    await screen.findByRole('link', { name: 'Release notes' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everything on this page' }))

    expect(screen.getByTestId('bulk-bar').textContent).toContain('2 selected')
  })

  it('publishes the selection in one request', async () => {
    const bulkPosts = vi.fn(async () => ({ action: 'publish' as const, requested: 2, changed: 2 }))
    renderSection(withPosts({ bulkPosts }))

    await screen.findByRole('link', { name: 'Release notes' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everything on this page' }))
    await userEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(bulkPosts).toHaveBeenCalledWith(['post_1', 'post_2'], 'publish')
    })
    // And the selection is cleared, because the rows underneath it just changed.
    expect(screen.queryByTestId('bulk-bar')).toBeNull()
  })

  it('asks before deleting a selection, and does nothing when told no', async () => {
    const bulkPosts = vi.fn()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderSection(withPosts({ bulkPosts }))

    await screen.findByRole('link', { name: 'Release notes' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Release notes' }))
    await userEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: 'Delete' }))

    expect(window.confirm).toHaveBeenCalled()
    expect(bulkPosts).not.toHaveBeenCalled()
  })

  it('reports the action back to the list rather than guessing', async () => {
    const bulkPosts = vi.fn(async () => ({ action: 'draft' as const, requested: 2, changed: 1 }))
    renderSection(withPosts({ bulkPosts }))

    await screen.findByRole('link', { name: 'Release notes' })
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select everything on this page' }))
    await userEvent.click(within(screen.getByTestId('bulk-bar')).getByRole('button', { name: 'Move to draft' }))

    await waitFor(() => {
      expect(bulkPosts).toHaveBeenCalledWith(['post_1', 'post_2'], 'draft')
    })
    // The wording of the answer is `describeBulk`'s, tested on its own below.
    expect(screen.queryByTestId('bulk-bar')).toBeNull()
  })
})

describe('the bulk result wording', () => {
  // The translator is a parameter now, so the test hands it the same one the
  // panel does. The wording stays asserted in English: that is what `en` says,
  // and a change to it should fail here.
  const t = createTranslator('en')

  it('says the count when everything changed', () => {
    expect(describeBulk({ action: 'publish', requested: 3, changed: 3 }, t)).toBe('3 items updated.')
    expect(describeBulk({ action: 'publish', requested: 1, changed: 1 }, t)).toBe('1 item updated.')
  })

  it('says how many were actually there when the selection was stale', () => {
    // The selection is made in a browser and somebody else may have deleted a
    // row between the list rendering and the button being pressed.
    expect(describeBulk({ action: 'delete', requested: 5, changed: 3 }, t)).toBe(
      '3 of 5 changed; the rest were already gone.',
    )
  })
})
