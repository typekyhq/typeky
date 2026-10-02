// @vitest-environment jsdom
import type { PostResponse } from '@typeky/api'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { PostEditorPage } from './post-editor'

/**
 * The block editor is replaced with a marker.
 *
 * What this screen is responsible for is the form around it -- which fields
 * reach the API, what happens when a slug is refused, and which of create and
 * replace is called. The editor itself has its own tests in @typeky/editor, and
 * mounting the real one would make every one of these depend on Tiptap.
 */
vi.mock('@/components/lazy-block-editor', () => ({
  LazyBlockEditor: ({ initialBlocks }: { initialBlocks?: unknown[] }) => (
    <div data-testid="block-editor">{`${initialBlocks?.length ?? 0} blocks`}</div>
  ),
}))

const POST: PostResponse = {
  id: 'post_1',
  title: 'Release notes',
  slug: 'release-notes',
  excerpt: 'What changed',
  coverMediaId: null,
  blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
  tags: ['release', 'notes'],
  category: 'News',
  seo: {},
  status: 'draft',
  revision: 2,
  publishedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
}

function renderEditor(client: ApiClient, path = '/posts/post_1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ApiClientProvider value={client}>
        <Routes>
          <Route path="/posts/:id" element={<PostEditorPage />} />
        </Routes>
      </ApiClientProvider>
    </MemoryRouter>,
  )
}

describe('opening a post', () => {
  it('fills the form from the server', async () => {
    renderEditor(
      fakeApiClient({
        async getPost() {
          return POST
        },
      }),
    )

    expect(await screen.findByLabelText('Title')).toHaveProperty('value', 'Release notes')
    expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'release-notes')
    expect(screen.getByLabelText('Excerpt')).toHaveProperty('value', 'What changed')
    expect(screen.getByLabelText('Category')).toHaveProperty('value', 'News')
    expect(screen.getByLabelText('Tags')).toHaveProperty('value', 'release, notes')
    expect(screen.getByTestId('block-editor').textContent).toBe('1 blocks')
  })

  it('says so when the post cannot be loaded', async () => {
    renderEditor(
      fakeApiClient({
        async getPost(): Promise<PostResponse> {
          throw new ApiError('not_found', 404, 'no post with that id')
        },
      }),
    )

    expect(await screen.findByText('Cannot load this post')).toBeTruthy()
  })
})

describe('the slug follows the title, but only for a new post', () => {
  it('derives one while creating', async () => {
    renderEditor(fakeApiClient(), '/posts/new')

    await userEvent.type(await screen.findByLabelText('Title'), 'Hello World Again')

    expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'hello-world-again')
  })

  it('stops deriving as soon as the slug is typed in', async () => {
    renderEditor(fakeApiClient(), '/posts/new')

    await userEvent.type(await screen.findByLabelText('Slug'), 'my-own-slug')
    await userEvent.type(screen.getByLabelText('Title'), 'Something else')

    expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'my-own-slug')
  })

  it('never rewrites an existing post, whose slug is its URL', async () => {
    renderEditor(
      fakeApiClient({
        async getPost() {
          return POST
        },
      }),
    )

    const title = await screen.findByLabelText('Title')
    await userEvent.clear(title)
    await userEvent.type(title, 'Release notes, revised')

    expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'release-notes')
  })

  it('leaves the slug empty when the title cannot produce one', async () => {
    // A Chinese title slugifies to nothing, and an empty slug is a validation
    // error the author can fix, which beats one made of hyphens.
    renderEditor(fakeApiClient(), '/posts/new')

    await userEvent.type(await screen.findByLabelText('Title'), '中文标题')

    expect(screen.getByLabelText('Slug')).toHaveProperty('value', '')
  })
})

describe('saving', () => {
  it('creates a new post with everything the form holds', async () => {
    const createPost = vi.fn(async (write: unknown) => ({ ...POST, ...(write as object) }))
    renderEditor(fakeApiClient({ createPost }), '/posts/new')

    await userEvent.type(await screen.findByLabelText('Title'), 'Hello World')
    await userEvent.type(screen.getByLabelText('Tags'), 'one, two')
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(createPost).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Hello World',
          slug: 'hello-world',
          tags: ['one', 'two'],
          status: 'published',
          // Cleared fields are null, not empty strings.
          excerpt: null,
          category: null,
        }),
      )
    })
  })

  it('replaces the loaded post rather than creating a second one', async () => {
    const savePost = vi.fn(async (_id: string, write: unknown) => ({ ...POST, ...(write as object) }))
    renderEditor(
      fakeApiClient({
        async getPost() {
          return POST
        },
        savePost,
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      expect(savePost).toHaveBeenCalledWith('post_1', expect.objectContaining({ status: 'draft' }))
    })
  })

  it('refuses to save a post with no slug, and says which field', async () => {
    const createPost = vi.fn()
    renderEditor(fakeApiClient({ createPost }), '/posts/new')

    await userEvent.type(await screen.findByLabelText('Title'), '中文标题')
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(createPost).not.toHaveBeenCalled()

    // The field, not just a toast: the message is zod's and its wording is not
    // this test's business, but which field is.
    const slug = await screen.findByLabelText('Slug')
    await waitFor(() => {
      expect(slug.getAttribute('aria-invalid')).toBe('true')
      expect(slug.getAttribute('aria-describedby')).toBe('slug-error')
    })
  })
})

describe('a slug that is already taken', () => {
  it('is reported on the field that caused it', async () => {
    const createPost = vi.fn(async () => {
      throw new ApiError('slug_taken', 409, 'The slug "release-notes" is already used by "Original".')
    })
    renderEditor(fakeApiClient({ createPost }), '/posts/new')

    await userEvent.type(await screen.findByLabelText('Title'), 'Release notes')
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    const message = await screen.findByText('The slug "release-notes" is already used by "Original".')
    // On the field, with the field pointing at it for assistive technology --
    // a toast alone disappears before it can be acted on.
    const slug = screen.getByLabelText('Slug')
    expect(slug.getAttribute('aria-describedby')).toBe('slug-error')
    expect(message.getAttribute('id')).toBe('slug-error')
    expect(slug.getAttribute('aria-invalid')).toBe('true')
  })
})
