// @vitest-environment jsdom
import type { PageResponse } from '@typeky/api'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { PageEditorPage } from './page-editor'

/** The editor itself is tested in @typeky/editor; this is the form around it. */
vi.mock('@/components/lazy-block-editor', () => ({
  LazyBlockEditor: ({ initialBlocks }: { initialBlocks?: unknown[] }) => (
    <div data-testid="block-editor">{`${initialBlocks?.length ?? 0} blocks`}</div>
  ),
}))

/**
 * The source editor is replaced with a textarea.
 *
 * CodeMirror measures its own layout, which jsdom has none of, and what these
 * tests are about is the form around it: which panel is on screen and what a save
 * sends.
 */
vi.mock('@/components/template-editor-surface', () => ({
  TemplateEditorSurface: ({
    initialSource,
    onChange,
  }: {
    initialSource: string
    onChange: (value: string) => void
  }) => (
    <textarea
      data-testid="source-editor"
      defaultValue={initialSource}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const PAGE: PageResponse = {
  id: 'page_about',
  title: 'About',
  slug: 'about',
  blocks: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body' }] }],
  useLayout: true,
  customSource: null,
  seo: {},
  status: 'draft',
  isHome: false,
  sortOrder: 3,
  revision: 2,
  publishedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
}

function renderEditor(client: ApiClient, path = '/pages/page_about') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <ApiClientProvider value={client}>
        <Routes>
          <Route path="/pages/:id" element={<PageEditorPage />} />
        </Routes>
      </ApiClientProvider>
    </MemoryRouter>,
  )
}

describe('opening a page', () => {
  it('fills the form, including the sort order as a string', async () => {
    renderEditor(
      fakeApiClient({
        async getPage() {
          return PAGE
        },
      }),
    )

    expect(await screen.findByLabelText('Title')).toHaveProperty('value', 'About')
    expect(screen.getByLabelText('Slug')).toHaveProperty('value', 'about')
    expect(screen.getByLabelText('Sort order')).toHaveProperty('value', '3')
    expect(screen.getByTestId('block-editor').textContent).toBe('1 blocks')
    expect(screen.getByTestId('page-meta').textContent).toContain('Not the home page')
  })

  it('says so when the page cannot be loaded', async () => {
    renderEditor(
      fakeApiClient({
        async getPage(): Promise<PageResponse> {
          throw new ApiError('not_found', 404, 'no page with that id')
        },
      }),
    )

    expect(await screen.findByText('Cannot load this page')).toBeTruthy()
  })
})

describe('saving a page', () => {
  it('creates one with the sort order as a number', async () => {
    const createPage = vi.fn(async (write: unknown) => ({ ...PAGE, ...(write as object) }))
    renderEditor(fakeApiClient({ createPage }), '/pages/new')

    await userEvent.type(await screen.findByLabelText('Title'), 'Contact us')
    await userEvent.clear(screen.getByLabelText('Sort order'))
    await userEvent.type(screen.getByLabelText('Sort order'), '5')
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    await waitFor(() => {
      expect(createPage).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Contact us', slug: 'contact-us', sortOrder: 5, status: 'published' }),
      )
    })
  })

  it('treats a blank sort order as zero rather than refusing the save', async () => {
    const createPage = vi.fn(async (write: unknown) => ({ ...PAGE, ...(write as object) }))
    renderEditor(fakeApiClient({ createPage }), '/pages/new')

    await userEvent.type(await screen.findByLabelText('Title'), 'Contact us')
    await userEvent.clear(screen.getByLabelText('Sort order'))
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      expect(createPage).toHaveBeenCalledWith(expect.objectContaining({ sortOrder: 0 }))
    })
  })

  it('reports a taken slug on the field', async () => {
    const createPage = vi.fn(async () => {
      throw new ApiError('slug_taken', 409, 'The slug "about" is already used by "About".')
    })
    renderEditor(fakeApiClient({ createPage }), '/pages/new')

    await userEvent.type(await screen.findByLabelText('Title'), 'About')
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    expect(await screen.findByText('The slug "about" is already used by "About".')).toBeTruthy()
    expect(screen.getByLabelText('Slug').getAttribute('aria-invalid')).toBe('true')
  })

  it('reports a reserved path on the same field, with the reason', async () => {
    const createPage = vi.fn(async () => {
      throw new ApiError('slug_reserved', 409, '"install" is reserved; the page would take that address.')
    })
    renderEditor(fakeApiClient({ createPage }), '/pages/new')

    await userEvent.type(await screen.findByLabelText('Title'), 'Installer')
    await userEvent.click(screen.getByRole('button', { name: 'Publish' }))

    // Naming the path is the point: "reserved" on its own leaves the operator
    // guessing which of their own rules they hit.
    expect(await screen.findByText('"install" is reserved; the page would take that address.')).toBeTruthy()
    expect(screen.getByLabelText('Slug').getAttribute('aria-invalid')).toBe('true')
  })
})

describe('the home page action', () => {
  it('is offered while the page is not the home page', async () => {
    renderEditor(
      fakeApiClient({
        async getPage() {
          return PAGE
        },
      }),
    )

    expect(await screen.findByRole('button', { name: 'Set as home' })).toBeTruthy()
  })

  it('sets it and then stops offering to', async () => {
    const setPageHome = vi.fn(async () => ({ ...PAGE, isHome: true }))
    renderEditor(
      fakeApiClient({
        async getPage() {
          return PAGE
        },
        setPageHome,
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Set as home' }))

    await waitFor(() => {
      expect(setPageHome).toHaveBeenCalledWith('page_about')
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Set as home' })).toBeNull()
    })
    expect(screen.getByTestId('page-meta').textContent).toContain('Home page')
  })
})

describe('a page that is its own document', () => {
  const CUSTOM: PageResponse = {
    ...PAGE,
    useLayout: false,
    customSource: '<h1>{{ content.title }}</h1>',
  }

  function withPage(page: PageResponse, overrides: Partial<ApiClient> = {}) {
    return fakeApiClient({
      async getPage() {
        return page
      },
      ...overrides,
    })
  }

  it('opens on the source instead of the block editor', async () => {
    renderEditor(withPage(CUSTOM))

    await userEvent.click(await screen.findByRole('tab', { name: 'Body' }))

    const source = (await screen.findByTestId('source-editor')) as HTMLTextAreaElement
    expect(source.value).toBe('<h1>{{ content.title }}</h1>')
    expect(screen.queryByTestId('block-editor')).toBeNull()
  })

  it('sends what the box holds, and the flag that says so', async () => {
    const savePage = vi.fn(async (_id: string, write: unknown) => ({ ...CUSTOM, ...(write as object) }))
    renderEditor(withPage(CUSTOM, { savePage }))

    const source = (await screen.findByTestId('source-editor')) as HTMLTextAreaElement
    await userEvent.clear(source)
    await userEvent.type(source, '<h1>Hello</h1>')
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      expect(savePage).toHaveBeenCalledWith(
        'page_about',
        expect.objectContaining({ useLayout: false, customSource: '<h1>Hello</h1>' }),
      )
    })
  })

  it('switches back to the blocks when the layout comes back on', async () => {
    renderEditor(withPage(CUSTOM))

    await userEvent.click(await screen.findByRole('tab', { name: 'Body' }))
    await userEvent.click(screen.getByLabelText('Use the theme layout'))

    expect(await screen.findByTestId('block-editor')).toBeTruthy()
    expect(screen.queryByTestId('source-editor')).toBeNull()
  })
})
