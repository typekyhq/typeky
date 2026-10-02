// @vitest-environment jsdom
import type { SiteResponse } from '@typeky/api'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiError, type ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { SettingsPage } from './settings'

const SITE: SiteResponse = {
  name: 'Typeky Demo',
  tagline: 'A small site',
  logoMediaId: 'media_logo',
  theme: 'default',
  settings: {
    accentColor: '#111827',
    footer: 'Built with Typeky.',
    seo: { defaultTitle: 'Typeky Demo' },
    socialLinks: [{ label: 'GitHub', href: 'https://github.com/typekyhq' }],
  },
  nav: [
    { label: 'Home', href: '/', order: 0 },
    { label: 'Blog', href: '/posts', order: 1 },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
}

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeApiClient({
    async getSite() {
      return SITE
    },
    async saveSite(write) {
      return { ...SITE, ...write, updatedAt: '2026-02-02T00:00:00.000Z' }
    },
    ...overrides,
  })
}

function renderPage(client: ApiClient) {
  return render(
    <ApiClientProvider value={client}>
      <SettingsPage />
    </ApiClientProvider>,
  )
}

describe('loading', () => {
  it('shows what the server has', async () => {
    renderPage(fakeClient())

    expect(await screen.findByLabelText('Name')).toHaveProperty('value', 'Typeky Demo')
    expect(screen.getByLabelText('Tagline')).toHaveProperty('value', 'A small site')
    expect(screen.getByLabelText('Footer text')).toHaveProperty('value', 'Built with Typeky.')
    expect(screen.getByLabelText('Item 1 label')).toHaveProperty('value', 'Home')
    expect(screen.getByLabelText('Link 1 label')).toHaveProperty('value', 'GitHub')
  })

  it('offers a retry instead of a dead screen', async () => {
    const getSite = vi
      .fn<ApiClient['getSite']>()
      .mockRejectedValueOnce(new ApiError('database_not_configured', 503))
      .mockResolvedValue(SITE)
    renderPage(fakeClient({ getSite }))

    expect(await screen.findByText('Cannot load the site settings')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByLabelText('Name')).toHaveProperty('value', 'Typeky Demo')
    expect(getSite).toHaveBeenCalledTimes(2)
  })
})

describe('saving', () => {
  it('sends the whole document, including the field the form cannot edit', async () => {
    const saveSite = vi.fn<ApiClient['saveSite']>(async (write) => ({ ...SITE, ...write }))
    renderPage(fakeClient({ saveSite }))

    const name = await screen.findByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'My Blog')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(saveSite).toHaveBeenCalledTimes(1))
    // The write replaces the row, so omitting the logo would silently clear it.
    expect(saveSite.mock.calls[0]?.[0]).toMatchObject({ name: 'My Blog', logoMediaId: 'media_logo' })
  })

  it('validates with the shared schema before it reaches the network', async () => {
    const saveSite = vi.fn<ApiClient['saveSite']>(async (write) => ({ ...SITE, ...write }))
    renderPage(fakeClient({ saveSite }))

    const name = await screen.findByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(name.getAttribute('aria-invalid')).toBe('true'))
    expect(saveSite).not.toHaveBeenCalled()
  })

  it('keeps the edit when the save fails', async () => {
    const saveSite = vi.fn<ApiClient['saveSite']>().mockRejectedValue(new ApiError('invalid_request', 400))
    renderPage(fakeClient({ saveSite }))

    const name = await screen.findByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Still Here')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(saveSite).toHaveBeenCalled())
    expect(screen.getByLabelText('Name')).toHaveProperty('value', 'Still Here')
  })
})

describe('navigation', () => {
  it('reorders and renumbers', async () => {
    renderPage(fakeClient())

    await userEvent.click(await screen.findByRole('button', { name: 'Move Blog up' }))

    expect(screen.getByLabelText('Item 1 label')).toHaveProperty('value', 'Blog')
    expect(screen.getByLabelText('Item 2 label')).toHaveProperty('value', 'Home')
  })

  it('disables the move buttons at the ends, so order cannot be lost', async () => {
    renderPage(fakeClient())

    expect((await screen.findByRole('button', { name: 'Move Home up' })).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Move Blog down' }).hasAttribute('disabled')).toBe(true)
  })

  it('adds and removes items', async () => {
    renderPage(fakeClient())
    await screen.findByLabelText('Item 1 label')

    await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getByLabelText('Item 3 label')).toHaveProperty('value', '')

    await userEvent.click(screen.getByRole('button', { name: 'Remove Home' }))
    expect(screen.queryByLabelText('Item 3 label')).toBeNull()
    expect(screen.getByLabelText('Item 1 label')).toHaveProperty('value', 'Blog')
  })

  it('renumbers the saved document after a removal', async () => {
    const saveSite = vi.fn<ApiClient['saveSite']>(async (write) => ({ ...SITE, ...write }))
    renderPage(fakeClient({ saveSite }))
    await screen.findByLabelText('Item 1 label')

    await userEvent.click(screen.getByRole('button', { name: 'Remove Home' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(saveSite).toHaveBeenCalledTimes(1))
    expect(saveSite.mock.calls[0]?.[0].nav).toEqual([{ label: 'Blog', href: '/posts', order: 0 }])
  })
})

describe('social links', () => {
  it('adds a link with a usable default', async () => {
    renderPage(fakeClient())

    await userEvent.click(await screen.findByRole('button', { name: 'Add link' }))

    expect(screen.getByLabelText('Link 2 URL')).toHaveProperty('value', 'https://')
  })

  it('gives every row its own label, so a screen reader can tell them apart', async () => {
    renderPage(fakeClient())
    await screen.findByLabelText('Link 1 label')

    expect(screen.getByLabelText('Link 1 label')).toHaveProperty('value', 'GitHub')
    expect(screen.getByLabelText('Link 1 URL')).toHaveProperty('value', 'https://github.com/typekyhq')
    expect(screen.getByLabelText('Item 1 link')).toHaveProperty('value', '/')
  })

  it('removes one', async () => {
    renderPage(fakeClient())

    await userEvent.click(await screen.findByRole('button', { name: 'Remove GitHub' }))

    expect(screen.queryByLabelText('Link 1 label')).toBeNull()
  })
})
