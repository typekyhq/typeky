// @vitest-environment jsdom
import type { Term, Vocabulary } from '@typeky/api'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import type { ApiClient } from '@/lib/api-client'
import { TaxonomyPage } from './taxonomy'

/**
 * The taxonomy screen.
 *
 * The two things worth pinning here are the ones a screenshot does not show: the
 * indent is the term's depth rather than a style someone chose, and the form for
 * a term owns its own state -- opening another term must not leave the previous
 * one's name behind to be saved.
 */

const VOCABULARY: Vocabulary = {
  id: 'v1',
  name: 'Categories',
  description: null,
  contentTypes: ['post'],
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const TERMS: Term[] = [
  {
    id: 't1',
    vocabularyId: 'v1',
    parentId: null,
    name: 'Engineering',
    slug: 'engineering',
    description: null,
    sortOrder: 0,
    depth: 0,
    usage: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 't2',
    vocabularyId: 'v1',
    parentId: 't1',
    name: 'Frontend',
    slug: 'frontend',
    description: null,
    sortOrder: 0,
    depth: 1,
    usage: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

function withTaxonomy(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeApiClient({
    async readTaxonomy() {
      return { vocabularies: [VOCABULARY], terms: TERMS }
    },
    ...overrides,
  })
}

function renderPage(client: ApiClient) {
  return render(
    <ApiClientProvider value={client}>
      <TaxonomyPage />
    </ApiClientProvider>,
  )
}

describe('the taxonomy screen', () => {
  it('lists the vocabularies and their terms', async () => {
    renderPage(withTaxonomy())

    const list = await screen.findByTestId('vocabulary-list')
    expect(within(list).getByText('Categories')).toBeTruthy()
    expect(within(list).getByText('2 terms')).toBeTruthy()

    const tree = screen.getByTestId('term-tree')
    expect(within(tree).getByText('Engineering')).toBeTruthy()
    expect(within(tree).getByText('Frontend')).toBeTruthy()
  })

  it('indents a term by its depth, not by its position', async () => {
    renderPage(withTaxonomy())

    await screen.findByTestId('term-tree')
    const parent = screen.getByText('Engineering').closest('li')
    const child = screen.getByText('Frontend').closest('li')

    // 0.5rem for the row, plus 1.25rem per level -- the same number the depth
    // field carries, which is what makes a nested term read as nested.
    expect(parent?.style.paddingInlineStart).toBe('0.5rem')
    expect(child?.style.paddingInlineStart).toBe('1.75rem')
  })

  it('says how much content carries a term', async () => {
    renderPage(withTaxonomy())

    await screen.findByTestId('term-tree')
    const row = screen.getByText('Frontend').closest('li')

    expect(within(row as HTMLElement).getByText('2 in use')).toBeTruthy()
  })

  it('offers to create the first vocabulary when there is none', async () => {
    renderPage(
      fakeApiClient({
        async readTaxonomy() {
          return { vocabularies: [], terms: [] }
        },
      }),
    )

    expect(await screen.findByText('No vocabularies yet.')).toBeTruthy()
    expect(screen.getByText('Pick a vocabulary')).toBeTruthy()
  })

  it('asks for a new vocabulary and creates it', async () => {
    const createVocabulary = vi.fn(async (input: { name: string }) => ({
      ...VOCABULARY,
      id: 'v2',
      name: input.name,
    }))
    renderPage(withTaxonomy({ createVocabulary }))

    await screen.findByTestId('vocabulary-list')
    await userEvent.click(screen.getByRole('button', { name: 'New vocabulary' }))

    const form = await screen.findByTestId('vocabulary-editor')
    await userEvent.type(within(form).getByLabelText('Name'), 'Topics')
    await userEvent.click(within(form).getByRole('button', { name: 'Create' }))

    expect(createVocabulary).toHaveBeenCalledTimes(1)
    expect(createVocabulary.mock.calls[0]?.[0]).toMatchObject({ name: 'Topics', contentTypes: [] })
  })

  it('creates a root term, deriving the slug from the name', async () => {
    const createTerm = vi.fn(async (input: Term) => ({ ...TERMS[0], ...input, id: 't9' }))
    renderPage(withTaxonomy({ createTerm }))

    await screen.findByTestId('term-tree')
    await userEvent.click(screen.getByRole('button', { name: 'New term' }))

    const form = await screen.findByTestId('term-editor')
    await userEvent.type(within(form).getByLabelText('Name'), 'Release notes')

    // The slug follows the name until it is typed by hand, the way the content
    // editors already behave.
    expect((within(form).getByLabelText('Slug') as HTMLInputElement).value).toBe('release-notes')

    await userEvent.click(within(form).getByRole('button', { name: 'Create' }))

    expect(createTerm.mock.calls[0]?.[0]).toMatchObject({
      vocabularyId: 'v1',
      parentId: null,
      name: 'Release notes',
      slug: 'release-notes',
    })
  })

  it('creates a child under the row it was asked from', async () => {
    const createTerm = vi.fn(async (input: Term) => ({ ...TERMS[0], ...input, id: 't9' }))
    renderPage(withTaxonomy({ createTerm }))

    await screen.findByTestId('term-tree')
    await userEvent.click(screen.getByRole('button', { name: 'Add a term under Engineering' }))

    const form = await screen.findByTestId('term-editor')
    await userEvent.type(within(form).getByLabelText('Name'), 'Backend')
    await userEvent.click(within(form).getByRole('button', { name: 'Create' }))

    expect(createTerm.mock.calls[0]?.[0]).toMatchObject({ parentId: 't1', slug: 'backend' })
  })

  it("does not offer a term's own descendants as its parent", async () => {
    renderPage(withTaxonomy())

    await screen.findByTestId('term-tree')
    await userEvent.click(screen.getByRole('button', { name: 'Edit Engineering' }))

    const parent = (await screen.findByTestId('term-editor')).querySelector('#term-parent')
    const options = [...(parent?.querySelectorAll('option') ?? [])].map((option) => option.textContent)

    // Neither itself nor Frontend, which sits under it. The server refuses a
    // cycle too; offering one would be offering a mistake.
    expect(options).toEqual(['No parent (top level)'])
  })

  it('opens another term with that term’s own values', async () => {
    renderPage(withTaxonomy())

    await screen.findByTestId('term-tree')
    await userEvent.click(screen.getByRole('button', { name: 'Edit Engineering' }))
    await userEvent.click(screen.getByRole('button', { name: 'Edit Frontend' }))

    const form = await screen.findByTestId('term-editor')
    expect((within(form).getByLabelText('Slug') as HTMLInputElement).value).toBe('frontend')
    expect((parentValue(form) ?? '').toString()).toBe('t1')
  })

  it('deletes a term only after asking, and says what it affects', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const deleteTerm = vi.fn(async () => undefined)
    renderPage(
      withTaxonomy({
        deleteTerm,
        async readTaxonomy() {
          return { vocabularies: [VOCABULARY], terms: TERMS }
        },
      }),
    )

    await screen.findByTestId('term-tree')
    await userEvent.click(screen.getByRole('button', { name: 'Delete Engineering' }))

    expect(confirm).toHaveBeenCalledWith(
      'Delete “Engineering”? Content filed under it or under its children becomes unfiled.',
    )
    expect(deleteTerm).toHaveBeenCalledWith('t1')

    confirm.mockRestore()
  })

  it('does not delete when the confirmation is declined', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deleteTerm = vi.fn(async () => undefined)
    renderPage(withTaxonomy({ deleteTerm }))

    await screen.findByTestId('term-tree')
    await userEvent.click(screen.getByRole('button', { name: 'Delete Engineering' }))

    expect(deleteTerm).not.toHaveBeenCalled()
    confirm.mockRestore()
  })
})

function parentValue(form: HTMLElement): string | undefined {
  return form.querySelector<HTMLSelectElement>('#term-parent')?.value
}
