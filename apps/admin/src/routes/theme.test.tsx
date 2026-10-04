// @vitest-environment jsdom
import { ApiError } from '@/lib/api-client'
import type { ThemeTemplateSummary } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/lib/api-client'
import { BASELINE_NAMES } from '@typeky/theme-default'
import { ApiClientProvider } from '@/lib/client-context'
import { LOCALES } from '@/locales'
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

/**
 * Opens a file from the tree, the way a person does: click its name.
 *
 * The name is the file and, for one that has been edited, the badge beside it.
 * Anchored, so that `post` does not also match `posts` and make the query
 * ambiguous.
 */
async function openFile(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: new RegExp(`^${name}(, Customised)?$`) }))
}

describe('the theme screen', () => {
  it('groups the templates the theme ships', async () => {
    renderSection(withTheme())

    const tree = await screen.findByTestId('theme-tree')

    // The folders, then the files inside them by name -- the way a file manager
    // lists them. The whole path is on the editor beside the tree.
    for (const title of ['Layouts', 'Templates', 'Snippets']) {
      expect(within(tree).getByText(title)).toBeTruthy()
    }
    for (const name of ['base', 'post', 'header']) {
      // By text rather than by role: the file that has been edited carries the
      // badge on its button, and this is asserting that the file is listed.
      expect(within(tree).getByText(name)).toBeTruthy()
    }
  })

  it('marks the ones that have been customised, and counts them', async () => {
    renderSection(withTheme())

    const row = (await screen.findByRole('button', { name: 'post, Customised' })).closest('li')!
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

  it('offers no way to add a template', async () => {
    // The theme ships a fixed set, and the tree is the only place a template can
    // be chosen from: every button in it is a folder or a file the theme put
    // there. The sentence that used to say so was removed to match the other
    // screens, so this asserts the absence itself rather than the notice.
    const { container } = renderSection(withTheme())
    await screen.findByTestId('theme-tree')

    const buttons = [...container.querySelectorAll('[data-testid=theme-tree] button')]
    expect(buttons.length).toBeGreaterThan(0)
    expect(buttons.some((button) => /new|add/i.test(button.textContent ?? ''))).toBe(false)
  })

  it('opens a template in the editor', async () => {
    renderSection(withTheme())

    await openFile('post')

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

    await openFile('post')
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

    await openFile('post')
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

    await openFile('post')
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

    await openFile('post')
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

  it('offers to restore the bundled template, and re-reads what came back', async () => {
    const resetThemeTemplate = vi.fn(async () => undefined)
    const listThemeTemplates = vi.fn(async () => ({ theme: 'default', items: ITEMS }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSection(withTheme({ resetThemeTemplate, listThemeTemplates }))

    await openFile('post')
    await screen.findByTestId('surface')

    // Only offered for a template that actually has an override.
    await userEvent.click(screen.getByRole('button', { name: 'Restore default' }))

    await waitFor(() => {
      expect(resetThemeTemplate).toHaveBeenCalledWith('templates/post')
    })
    // Re-read rather than assumed: the editor shows the baseline again.
    await waitFor(() => {
      expect(screen.getByTestId('surface')).toHaveProperty('value', 'SOURCE OF templates/post')
    })
  })

  it('replaces what the editor holds, rather than only the source beside it', async () => {
    const resetThemeTemplate = vi.fn(async () => undefined)
    const listThemeTemplates = vi.fn(async () => ({ theme: 'default', items: ITEMS }))
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSection(withTheme({ resetThemeTemplate, listThemeTemplates }))

    await openFile('post')
    await screen.findByTestId('surface')

    // Typed into, so the editor's own text differs from the source in state. This is
    // the part the test above could not see: an editor that is not replaced keeps
    // showing what was typed, however correct the source beside it has become.
    await userEvent.clear(screen.getByTestId('surface'))
    await userEvent.type(screen.getByTestId('surface'), 'mine')

    await userEvent.click(screen.getByRole('button', { name: 'Restore default' }))

    await waitFor(() => {
      expect(screen.getByTestId('surface')).toHaveProperty('value', 'SOURCE OF templates/post')
    })
  })

  it('does not offer to restore a template that has no override', async () => {
    renderSection(
      withTheme({
        async listThemeTemplates() {
          return { theme: 'default', items: ITEMS.map((item) => ({ ...item, overridden: false })) }
        },
      }),
    )

    await openFile('post')
    await screen.findByTestId('surface')

    expect(screen.queryByRole('button', { name: 'Restore default' })).toBeNull()
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

/**
 * Files on the left, the open one on the right.
 *
 * The point of the layout is that moving between templates is a click rather
 * than an open-and-close, so what is worth pinning is that the tree says which
 * file is open, that a folder can be folded away, and that nothing pretends to
 * be a file before one is chosen.
 */
describe('choosing a file', () => {
  it('opens with nothing chosen, and says so', async () => {
    renderSection(withTheme())

    expect(await screen.findByText('Choose a template')).toBeTruthy()
    expect(screen.getByText(/Pick one on the left/)).toBeTruthy()
    expect(screen.queryByTestId('open-path')).toBeNull()
  })

  it('marks the file that is open, and shows its whole path beside the editor', async () => {
    renderSection(withTheme())
    await openFile('post')

    // The tree names it the way a file manager does; the editor names it the way
    // the rest of the platform does, because that is the string a template uses.
    expect(screen.getByRole('button', { name: 'post, Customised' }).getAttribute('aria-current')).toBe('true')
    expect(screen.getByTestId('open-path').textContent).toBe('templates/post')
  })

  it('says what the file is for beside the editor, not under every name', async () => {
    renderSection(withTheme())
    await openFile('post')

    // The tree stays one line to a file: a description under each of fifteen
    // names turns a list into a wall of text, and scanning the list is the one
    // thing it has to be good at.
    const tree = screen.getByTestId('theme-tree')
    expect(within(tree).queryByText(/^One blog post/)).toBeNull()
    expect(screen.getByTestId('open-description').textContent).toMatch(/^One blog post/)
  })

  it('replaces what is open when another file is chosen', async () => {
    renderSection(withTheme())

    await openFile('post')
    await screen.findByTestId('surface')

    await openFile('base')

    await waitFor(() => {
      expect(screen.getByTestId('open-path').textContent).toBe('layouts/base')
      expect(screen.getByTestId('surface')).toHaveProperty('value', 'SOURCE OF layouts/base')
    })
    expect(screen.getByRole('button', { name: 'base' }).getAttribute('aria-current')).toBe('true')
  })

  it('folds a folder away and back', async () => {
    renderSection(withTheme())

    const folder = await screen.findByRole('button', { name: /^Templates/ })
    expect(folder.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('post')).toBeTruthy()

    await userEvent.click(folder)

    expect(screen.getByRole('button', { name: /^Templates/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('post')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: /^Templates/ }))

    expect(screen.getByText('post')).toBeTruthy()
  })
})

/**
 * Every file the bundled theme ships, described, in every language.
 *
 * The descriptions are keyed by path, and a path the theme gains without a
 * description would show up as an empty space in a tree whose whole point -- for
 * this reader -- is telling them what `seo-meta` means. Asking the theme package
 * for its file list is what makes this exhaustive rather than a sample.
 */
describe('the file descriptions', () => {
  it.each(Object.keys(LOCALES))('%s describes every file the bundled theme ships', (language) => {
    const table = LOCALES[language] ?? {}

    const missing = BASELINE_NAMES.filter(
      (path) => table[`theme.file.${path.replace(/\//g, '.')}`] === undefined,
    )

    expect(missing).toEqual([])
  })
})

/**
 * The two documents, read before deciding whether to keep them.
 *
 * The links open a view inside the panel rather than handing the file to the
 * downloads folder: the point of both documents is that somebody *reads* them, and
 * the download is a button inside the view.
 */
describe('the authoring documents', () => {
  it('opens one in the panel, with the text and a download', async () => {
    const readThemeDocument = vi.fn(async () => '# Theme syntax\n\nOnly these tags exist.')
    renderSection(withTheme({ readThemeDocument }))

    await userEvent.click(await screen.findByRole('button', { name: 'theme syntax' }))

    expect(readThemeDocument).toHaveBeenCalledWith('syntax')
    const view = await screen.findByTestId('theme-document')
    expect(within(view).getByText(/Only these tags exist/)).toBeTruthy()
    // The download is a real link to the endpoint the API serves as an attachment.
    expect(within(view).getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(
      '/api/admin/theme/syntax',
    )
  })

  it('reads the other one too', async () => {
    const readThemeDocument = vi.fn(async () => '# Prompt: write a Typeky theme template')
    renderSection(withTheme({ readThemeDocument }))

    await userEvent.click(await screen.findByRole('button', { name: 'prompt for an AI' }))

    expect(readThemeDocument).toHaveBeenCalledWith('prompt')
    const view = await screen.findByTestId('theme-document')
    expect(within(view).getByRole('link', { name: 'Download' }).getAttribute('href')).toBe(
      '/api/admin/theme/prompt',
    )
  })

  it('reports a document it cannot read, rather than an empty view', async () => {
    renderSection(
      withTheme({
        readThemeDocument: vi.fn(async () => {
          throw new ApiError('internal_error', 500)
        }),
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'theme syntax' }))

    await waitFor(() => expect(screen.queryByTestId('theme-document')).toBeNull())
  })
})
