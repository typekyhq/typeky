// @vitest-environment jsdom
import type { ThemeTemplateSummary } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { ThemeSection } from './theme'

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

  it('shows the source when one is opened', async () => {
    renderSection(withTheme())

    const row = (await screen.findByText('templates/post')).closest('li')!
    await userEvent.click(within(row).getByRole('button', { name: 'View' }))

    await waitFor(() => {
      expect(screen.getByText('SOURCE OF templates/post')).toBeTruthy()
    })
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
