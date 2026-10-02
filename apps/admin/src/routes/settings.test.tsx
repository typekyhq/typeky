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

describe('the logo', () => {
  it('can be chosen from the media library instead of pasting an id', async () => {
    renderPage(fakeClient())

    await userEvent.click(await screen.findByRole('button', { name: 'Choose logo' }))

    expect(await screen.findByText('Choose for logo')).toBeTruthy()
  })

  it('is carried through a save when it is not touched', async () => {
    const saveSite = vi.fn(async (write: unknown) => ({ ...SITE, ...(write as object) }))
    renderPage(fakeClient({ saveSite }))

    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(saveSite).toHaveBeenCalledWith(expect.objectContaining({ logoMediaId: 'media_logo' }))
    })
  })
})

/**
 * The first run of a deployment.
 *
 * A fresh deploy has no site row, the read answers 404, and the write is an
 * upsert -- so the way to create the row is to fill this form in. The screen used
 * to show an error on that 404, which left the only way to set the site up
 * unavailable and the public pages answering 503 forever. Found while writing the
 * deployment guide, which is the sort of thing a deployment guide is for.
 */
describe('a deployment that has not been set up yet', () => {
  /** The read that a fresh deploy gets: no row. */
  function coldStart(overrides: Partial<ApiClient> = {}): ApiClient {
    return fakeClient({
      getSite: vi.fn<ApiClient['getSite']>().mockRejectedValue(new ApiError('not_found', 404)),
      ...overrides,
    })
  }

  it('offers the form rather than an error, and says what saving will do', async () => {
    renderPage(coldStart())

    expect(await screen.findByText('This site has not been set up yet')).toBeTruthy()
    expect(screen.getByText(/answer 503 until something is saved here/)).toBeTruthy()
    // The state this file already covers for a different reason is not what a
    // missing row should produce.
    expect(screen.queryByText('Cannot load the site settings')).toBeNull()
  })

  it('creates the row when the form is saved', async () => {
    const saveSite = vi.fn<ApiClient['saveSite']>(async (write) => ({ ...SITE, ...write }))
    renderPage(coldStart({ saveSite }))

    await userEvent.type(await screen.findByLabelText('Name'), 'My site')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(saveSite).toHaveBeenCalledTimes(1))
    expect(saveSite.mock.calls[0]?.[0]).toMatchObject({ name: 'My site', theme: 'default', nav: [] })
  })

  it('stops saying so once it has been saved', async () => {
    renderPage(coldStart({ saveSite: vi.fn<ApiClient['saveSite']>(async (write) => ({ ...SITE, ...write })) }))

    await userEvent.type(await screen.findByLabelText('Name'), 'My site')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByText('This site has not been set up yet')).toBeNull())
  })
})

/**
 * Language and dates.
 *
 * Four settings, two for the site and two for this panel, and the point of each
 * is that it changes something a person can see. The previews are the part worth
 * testing: a format string is not readable, and a settings screen that accepts
 * one without showing what it produces is a screen that makes the operator
 * deploy to find out.
 */
describe('language and dates', () => {
  it('shows what the site date format will produce', async () => {
    renderPage(
      fakeClient({
        async getSite() {
          return { ...SITE, settings: { ...SITE.settings, dateFormat: '%Y年%-m月%-d日' } }
        },
      }),
    )

    const field = await screen.findByLabelText('Site date format')

    expect(field).toHaveProperty('value', '%Y年%-m月%-d日')
    // The preview instant is 2026-01-05T09:07:03Z, rendered in UTC.
    expect(screen.getByText(/2026年1月5日/)).toBeTruthy()
  })

  it('shows the default format when the site has not chosen one', async () => {
    renderPage(fakeClient())

    await screen.findByLabelText('Site date format')

    expect(screen.getByText(/January 5, 2026/)).toBeTruthy()
  })

  it('refuses a directive it cannot render, before the network', async () => {
    const saveSite = vi.fn<ApiClient['saveSite']>(async (write) => ({ ...SITE, ...write }))
    renderPage(fakeClient({ saveSite }))

    const field = await screen.findByLabelText('Site date format')
    await userEvent.clear(field)
    // `%q` renders as "nd" in the theme, which is why it has to be refused here
    // rather than discovered in a footer.
    await userEvent.type(field, '%q')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(saveSite).not.toHaveBeenCalled()
    expect(await screen.findByText(/use only the listed directives/)).toBeTruthy()
  })

  it('saves the site language', async () => {
    const saveSite = vi.fn<ApiClient['saveSite']>(async (write) => ({ ...SITE, ...write }))
    renderPage(fakeClient({ saveSite }))

    const language = await screen.findByLabelText('Site language')
    await userEvent.clear(language)
    await userEvent.type(language, 'zh-CN')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(saveSite).toHaveBeenCalledTimes(1))
    expect(saveSite.mock.calls[0]?.[0]).toMatchObject({ settings: { language: 'zh-CN' } })
  })

  it('saves the panel date format', async () => {
    // The panel's own two settings sit under `settings.admin`, so that changing
    // how the site writes a date does not change how the panel does.
    const saveSite = vi.fn<ApiClient['saveSite']>(async (write) => ({ ...SITE, ...write }))
    renderPage(fakeClient({ saveSite }))

    const field = await screen.findByLabelText('Panel date format')
    await userEvent.type(field, '%H:%M')
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(saveSite).toHaveBeenCalledTimes(1))
    const written = saveSite.mock.calls[0]?.[0]

    expect(written?.settings.admin?.dateFormat).toBe('%H:%M')
    // Untouched fields come back as they were loaded -- the fixture has no site
    // date format, and editing the panel's must not invent one.
    expect(written?.settings.dateFormat).toBeUndefined()
  })

  it('offers only the languages this panel is translated into', async () => {
    renderPage(fakeClient())

    const select = await screen.findByLabelText('Panel language')
    const options = [...select.querySelectorAll('option')].map((option) => option.getAttribute('value'))

    // The list is what the panel can actually render, so it grows when a
    // translation is added rather than when somebody wants one.
    expect(options).toEqual(['en', 'zh-CN'])
  })
})
