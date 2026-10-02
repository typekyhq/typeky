// @vitest-environment jsdom
import type { PostResponse, PostSummary } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { PostsSection } from './posts'

const POSTS: PostSummary[] = [
  {
    id: 'post_1',
    title: 'Release notes',
    slug: 'release-notes',
    excerpt: 'What changed',
    category: 'News',
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
    category: null,
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
