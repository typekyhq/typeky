// @vitest-environment jsdom
import type { SiteResponse } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
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
    faviconMediaId: null,
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

/**
 * Opens a panel.
 *
 * Needed because a panel that is not on screen is hidden, and that is not a
 * detail of the implementation: a field in a closed panel cannot be typed into or
 * clicked any more than a person could, so a test has to go there first.
 */
async function openTab(name: string): Promise<void> {
  await userEvent.click(await screen.findByRole('tab', { name }))
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
    await openTab('Navigation')

    await userEvent.click(await screen.findByRole('button', { name: 'Move Blog up' }))

    expect(screen.getByLabelText('Item 1 label')).toHaveProperty('value', 'Blog')
    expect(screen.getByLabelText('Item 2 label')).toHaveProperty('value', 'Home')
  })

  it('disables the move buttons at the ends, so order cannot be lost', async () => {
    renderPage(fakeClient())
    await openTab('Navigation')

    expect((await screen.findByRole('button', { name: 'Move Home up' })).hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Move Blog down' }).hasAttribute('disabled')).toBe(true)
  })

  it('adds and removes items', async () => {
    renderPage(fakeClient())
    await openTab('Navigation')

    await userEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(screen.getByLabelText('Item 3 label')).toHaveProperty('value', '')

    await userEvent.click(screen.getByRole('button', { name: 'Remove Home' }))
    expect(screen.queryByLabelText('Item 3 label')).toBeNull()
    expect(screen.getByLabelText('Item 1 label')).toHaveProperty('value', 'Blog')
  })

  it('renumbers the saved document after a removal', async () => {
    const saveSite = vi.fn<ApiClient['saveSite']>(async (write) => ({ ...SITE, ...write }))
    renderPage(fakeClient({ saveSite }))
    await openTab('Navigation')

    await userEvent.click(screen.getByRole('button', { name: 'Remove Home' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(saveSite).toHaveBeenCalledTimes(1))
    expect(saveSite.mock.calls[0]?.[0].nav).toEqual([{ label: 'Blog', href: '/posts', order: 0 }])
  })
})

describe('social links', () => {
  it('adds a link with a usable default', async () => {
    renderPage(fakeClient())
    await openTab('Social links')

    await userEvent.click(await screen.findByRole('button', { name: 'Add link' }))

    expect(screen.getByLabelText('Link 2 URL')).toHaveProperty('value', 'https://')
  })

  it('gives every row its own label, so a screen reader can tell them apart', async () => {
    renderPage(fakeClient())
    await openTab('Social links')

    expect(screen.getByLabelText('Link 1 label')).toHaveProperty('value', 'GitHub')
    expect(screen.getByLabelText('Link 1 URL')).toHaveProperty('value', 'https://github.com/typekyhq')
    expect(screen.getByLabelText('Item 1 link')).toHaveProperty('value', '/')
  })

  it('removes one', async () => {
    renderPage(fakeClient())
    await openTab('Social links')

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

  it('takes reserved paths as one per line, ignoring blanks and repeats', async () => {
    const saveSite = vi.fn(async (write: unknown) => ({ ...SITE, ...(write as object) }))
    renderPage(fakeClient({ saveSite }))

    const field = await screen.findByLabelText('Reserved paths')
    await userEvent.click(field)
    // What a list pasted out of a note looks like: a blank line between sections,
    // and the same path twice.
    await userEvent.paste('/install\n/shop\n\n/shop')

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => {
      expect(saveSite).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: expect.objectContaining({ reservedPaths: ['/install', '/shop'] }),
        }),
      )
    })
  })

  it('has a browser icon beside it, chosen the same way', async () => {
    renderPage(fakeClient())

    // A favicon is site branding like the logo is, so it is chosen from the media
    // library rather than typed as a path or left to a theme to invent.
    expect(await screen.findByRole('button', { name: 'Choose browser icon' })).toBeTruthy()
  })

  it('sends the browser icon through a save even while it is empty', async () => {
    const saveSite = vi.fn(async (write: unknown) => ({ ...SITE, ...(write as object) }))
    renderPage(fakeClient({ saveSite }))

    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }))

    // The write replaces the row: a field the form does not send is a field the save
    // clears.
    await waitFor(() => {
      expect(saveSite).toHaveBeenCalledWith(expect.objectContaining({ faviconMediaId: null }))
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

/**
 * The panels as tabs.
 *
 * This screen is one document with one Save button, and the tabs are only a way
 * of laying it out -- so the properties worth pinning are that all of it is still
 * there, and that a failure nobody can see is one they are taken to.
 */
describe('the tabs', () => {
  it('offers every panel, with the first one open', async () => {
    renderPage(fakeClient())

    const tablist = await screen.findByRole('tablist', { name: 'Settings sections' })
    const tabs = within(tablist).getAllByRole('tab')

    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Identity',
      'Navigation',
      'Social links',
      'SEO defaults',
      'Footer',
      'Language and dates',
      'Licence',
    ])
    expect(within(tablist).getByRole('tab', { selected: true }).textContent).toBe('Identity')
  })

  it('shows the panel that was asked for and hides the rest', async () => {
    const { container } = renderPage(fakeClient())

    await userEvent.click(await screen.findByRole('tab', { name: 'Footer' }))

    expect(screen.getByRole('tab', { name: 'Footer', selected: true })).toBeTruthy()
    expect(screen.getByRole('tabpanel', { name: 'Footer' }).hasAttribute('hidden')).toBe(false)

    // Six of the seven are hidden rather than removed: the form is the document,
    // and a panel that unmounted would take its fields out of it.
    const hidden = [...container.querySelectorAll('[role=tabpanel][hidden]')]

    expect(hidden).toHaveLength(6)
    expect(screen.getByLabelText('Name')).toBeTruthy()
  })

  it('moves between them with the arrow keys', async () => {
    renderPage(fakeClient())

    const identity = await screen.findByRole('tab', { name: 'Identity' })
    await userEvent.click(identity)
    await userEvent.keyboard('{ArrowRight}')

    expect(screen.getByRole('tab', { name: 'Navigation', selected: true })).toBeTruthy()
  })

  it('goes to the panel a failed save was about', async () => {
    renderPage(fakeClient())

    // The mistake is made on one panel and the save is pressed on another, which
    // is what splitting a long form up makes ordinary.
    await openTab('Language and dates')
    const dateFormat = await screen.findByLabelText('Site date format')
    await userEvent.clear(dateFormat)
    await userEvent.type(dateFormat, '%q')
    await openTab('Identity')

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('tab', { name: 'Language and dates', selected: true })).toBeTruthy()
    expect(screen.getByText(/use only the listed directives/)).toBeTruthy()
  })

  it('leaves the tab alone when the failing field is the one already open', async () => {
    renderPage(fakeClient())

    const name = await screen.findByLabelText('Name')
    await userEvent.clear(name)
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(screen.getByRole('tab', { name: 'Identity', selected: true })).toBeTruthy()
  })
})
