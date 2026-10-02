// @vitest-environment jsdom
import { ApiError } from '@/lib/api-client'
import type { ThemeTemplateSummary } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { ThemeSection } from './theme'

/**
 * The editor is replaced with a textarea.
 *
 * CodeMirror measures its own layout, which jsdom has none of, and the point of
 * these tests is the screen around it: what is loaded, what is saved, and what
 * happens when the server refuses. The editor itself is exercised in a browser,
 * where there is a layout to measure.
 */
vi.mock('@/components/template-editor-surface', () => ({
  TemplateEditorSurface: ({
    initialSource,
    onChange,
    errorLine,
  }: {
    initialSource: string
    onChange: (value: string) => void
    errorLine?: number | null
  }) => (
    <textarea
      data-testid="surface"
      data-error-line={String(errorLine ?? '')}
      defaultValue={initialSource}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}))

const ITEMS: ThemeTemplateSummary[] = [
  { path: 'layouts/base', group: 'layouts', overridden: false, bytes: 400, updatedAt: null },
  {
    path: 'templates/post',
    group: 'templates',
    overridden: true,
    bytes: 512,
    updatedAt: '2026-02-02T00:00:00.000Z',
  },
  { path: 'snippets/header', group: 'snippets', overridden: false, bytes: 300, updatedAt: null },
]

function renderSection(client: ApiClient) {
  return render(
    <ApiClientProvider value={client}>
      <ThemeSection />
    </ApiClientProvider>,
  )
}

function withTheme(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeApiClient({
    async listThemeTemplates() {
      return { theme: 'default', items: ITEMS }
    },
    async getThemeTemplate(path) {
      return { path, source: 'SOURCE OF ' + path, overridden: false, updatedAt: null }
    },
    ...overrides,
  })
}

describe('the theme screen', () => {
  it('groups the templates the theme ships', async () => {
    renderSection(withTheme())

    for (const title of ['Layouts', 'Templates', 'Snippets']) {
      expect(await screen.findByText(title)).toBeTruthy()
    }
    expect(screen.getByText('layouts/base')).toBeTruthy()
    expect(screen.getByText('templates/post')).toBeTruthy()
    expect(screen.getByText('snippets/header')).toBeTruthy()
  })

  it('marks the ones that have been customised, and counts them', async () => {
    renderSection(withTheme())

    const row = (await screen.findByText('templates/post')).closest('li')!
    expect(within(row).getByTestId('customised-marker').textContent).toBe('Customised')
    expect(screen.getByText('1 of 3 templates have been customised.')).toBeTruthy()
  })

  it('says the count is nothing when every template is the bundled one', async () => {
    renderSection(
      withTheme({
        async listThemeTemplates() {
          return { theme: 'default', items: ITEMS.map((item) => ({ ...item, overridden: false })) }
        },
      }),
    )

    expect(await screen.findByText('Every template is the one the default theme ships.')).toBeTruthy()
  })

  it('says that templates cannot be added, rather than leaving it to be discovered', async () => {
    renderSection(withTheme())

    expect(await screen.findByText(/There is no way to add a new one/)).toBeTruthy()
    // And no control offers one.
    expect(screen.queryByRole('button', { name: /new template/i })).toBeNull()
  })

  it('opens a template in the editor', async () => {
    renderSection(withTheme())

    const row = (await screen.findByText('templates/post')).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))

    await waitFor(() => {
      expect(screen.getByTestId('surface')).toHaveProperty('value', 'SOURCE OF templates/post')
    })
  })

  it('saves what was edited', async () => {
    const saveThemeTemplate = vi.fn(async (path: string, source: string) => ({
      path,
      source,
      overridden: true,
      updatedAt: '2026-03-03T00:00:00.000Z',
    }))
    renderSection(withTheme({ saveThemeTemplate }))

    const row = (await screen.findByText('templates/post')).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    await screen.findByTestId('surface')

    await userEvent.clear(screen.getByTestId('surface'))
    await userEvent.type(screen.getByTestId('surface'), '<h1>Custom</h1>')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(saveThemeTemplate).toHaveBeenCalledWith('templates/post', '<h1>Custom</h1>')
    })
  })

  it('shows what the server said, and where', async () => {
    const saveThemeTemplate = vi.fn(async () => {
      // What the API answers for a template that will not parse.
      throw new ApiError('invalid_request', 400, 'tag {% if a %} not closed', 3)
    })
    renderSection(withTheme({ saveThemeTemplate }))

    const row = (await screen.findByText('templates/post')).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    await screen.findByTestId('surface')

    await userEvent.clear(screen.getByTestId('surface'))
    // userEvent reads a bare `{` as the start of a key descriptor; doubling it
    // is how a literal brace is typed.
    await userEvent.type(screen.getByTestId('surface'), '{{% if a %}}')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    const problem = await screen.findByTestId('template-problem')
    expect(problem.textContent).toContain('Line 3')
    expect(problem.textContent).toContain('not closed')
    // And the editor is told which line, so it can mark and scroll to it.
    expect(screen.getByTestId('surface').getAttribute('data-error-line')).toBe('3')
  })

  it('leaves Save and Discard unavailable until something changes', async () => {
    renderSection(withTheme())

    const row = (await screen.findByText('templates/post')).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    await screen.findByTestId('surface')

    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true)
    expect(screen.getByText('No changes.')).toBeTruthy()

    await userEvent.type(screen.getByTestId('surface'), 'x')

    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', false)
    expect(screen.getByText('Unsaved changes.')).toBeTruthy()
  })

  it('previews the unsaved source in a sandboxed frame', async () => {
    const previewThemeTemplate = vi.fn(async (_path: string, source: string) => ({
      html: `<html><body>rendered from ${source.length} bytes</body></html>`,
      bytes: 60,
    }))
    renderSection(withTheme({ previewThemeTemplate }))

    const row = (await screen.findByText('templates/post')).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }))
    await screen.findByTestId('surface')

    // Edited but not saved, and the preview must use the edit rather than what
    // the server has.
    await userEvent.type(screen.getByTestId('surface'), '!')
    await userEvent.click(screen.getByRole('button', { name: 'Preview' }))

    await waitFor(() => {
      expect(previewThemeTemplate).toHaveBeenCalledWith(
        'templates/post',
        'SOURCE OF templates/post!',
      )
    })

    const frame = await screen.findByTestId('template-preview')
    // Fully sandboxed: no scripts and no same-origin, so a mistake in a template
    // cannot reach the admin's session or its DOM.
    expect(frame.getAttribute('sandbox')).toBe('')
    expect(frame.getAttribute('srcdoc')).toContain('rendered from')
  })

  it('says so when the theme cannot be loaded', async () => {
    renderSection(
      withTheme({
        async listThemeTemplates(): Promise<never> {
          throw new Error('the server is down')
        },
      }),
    )

    expect(await screen.findByText('Cannot load the theme')).toBeTruthy()
  })
})
