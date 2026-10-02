// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import type { Session } from '@typeky/api'
import { ATTRIBUTION } from '@typeky/core'
import { en } from '@/locales/en'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { ApiError, type ApiClient } from './lib/api-client'
import { NAVIGATION } from './lib/navigation'
import { fakeApiClient } from './lib/testing'

const SESSION: Session = {
  actorId: 'admin',
  csrfToken: 'a-token-value',
  createdAt: '2026-01-01T00:00:00.000Z',
}

function never(): Promise<never> {
  return new Promise(() => undefined)
}

function fakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeApiClient({
    async signIn() {
      return SESSION
    },
    async loadSession() {
      return SESSION
    },
    ...overrides,
  })
}

function renderApp(client: ApiClient, path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App client={client} />
    </MemoryRouter>,
  )
}

const signedOut = fakeClient({
  async loadSession(): Promise<Session> {
    throw new ApiError('unauthorized', 401)
  },
})

describe('startup', () => {
  it('asks the server whether a session exists before deciding anything', async () => {
    const loadSession = vi.fn(() => never())
    renderApp(fakeClient({ loadSession }))

    expect(screen.getByRole('status')).toBeTruthy()
    expect(screen.getByText('Checking your session')).toBeTruthy()
    expect(loadSession).toHaveBeenCalledTimes(1)
  })

  it('goes straight to the shell when the cookie is still valid', async () => {
    renderApp(fakeClient())

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeTruthy()
  })

  it('distinguishes a dead server from a missing session', async () => {
    renderApp(
      fakeClient({
        async loadSession(): Promise<Session> {
          throw new ApiError('internal_error', 500)
        },
      }),
    )

    // Telling somebody their password is wrong when the network is down would be
    // worse than saying nothing, so this is its own screen.
    expect(await screen.findByText('Cannot reach the server')).toBeTruthy()
    expect(screen.queryByLabelText('Password')).toBeNull()
  })

  it('retries when asked', async () => {
    const loadSession = vi
      .fn<ApiClient['loadSession']>()
      .mockRejectedValueOnce(new ApiError('internal_error', 500))
      .mockResolvedValue(SESSION)
    renderApp(fakeClient({ loadSession }))

    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeTruthy()
    expect(loadSession).toHaveBeenCalledTimes(2)
  })
})

describe('signing in', () => {
  it('labels every control and submits with the keyboard', async () => {
    const signIn = vi.fn<ApiClient['signIn']>(async () => SESSION)
    renderApp(fakeClient({ loadSession: signedOut.loadSession, signIn }))

    const username = await screen.findByLabelText('Username')
    await userEvent.type(username, 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'hunter2{Enter}')

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith({ username: 'admin', password: 'hunter2' })
    })
    expect(await screen.findByRole('navigation', { name: 'Sections' })).toBeTruthy()
  })

  it('says what went wrong without relying on colour', async () => {
    renderApp(
      fakeClient({
        loadSession: signedOut.loadSession,
        async signIn(): Promise<Session> {
          throw new ApiError('invalid_credentials', 401)
        },
      }),
    )

    await userEvent.type(await screen.findByLabelText('Username'), 'admin')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong{Enter}')

    const message = await screen.findByRole('alert')
    expect(message.textContent).toContain('Wrong username or password.')
    expect(screen.getByLabelText('Username')).toBeTruthy()
  })
})

describe('the shell', () => {
  it('lists every section as a link', async () => {
    renderApp(fakeClient())

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    for (const section of NAVIGATION) {
      // The label comes from the locale file, because that is now where the
      // words are -- and a key pointing at nothing would fail this.
      expect(within(nav).getByRole('link', { name: en[section.labelKey] })).toBeTruthy()
    }
  })

  it('marks the current section for assistive technology, not just with a class', async () => {
    renderApp(fakeClient(), '/posts')

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByRole('link', { name: 'Posts' }).getAttribute('aria-current')).toBe('page')
    expect(within(nav).getByRole('link', { name: 'Pages' }).getAttribute('aria-current')).toBeNull()
  })

  it('shows where you are as a breadcrumb trail', async () => {
    renderApp(fakeClient(), '/theme')

    const trail = await screen.findByRole('navigation', { name: /breadcrumb/i })
    expect(within(trail).getByText('Dashboard')).toBeTruthy()
    expect(within(trail).getByText('Theme')).toBeTruthy()
  })

  it('builds the breadcrumb as a list a screen reader can read', async () => {
    // A Lighthouse audit caught a wrapper element between the <ol> and its <li>
    // children, which is invalid markup. This asserts the structure directly.
    renderApp(fakeClient(), '/theme')

    const trail = await screen.findByRole('navigation', { name: /breadcrumb/i })
    const list = trail.querySelector('ol')

    expect(list).not.toBeNull()
    expect(Array.from(list?.children ?? []).map((child) => child.tagName)).toEqual(['LI', 'LI', 'LI'])
  })

  it('serves one screen per section, and none for an unknown path', async () => {
    renderApp(fakeClient(), '/media')
    expect(await screen.findByRole('heading', { name: 'Media', level: 1 })).toBeTruthy()

    renderApp(fakeClient(), '/nope')
    expect(await screen.findByRole('heading', { name: 'Not found', level: 1 })).toBeTruthy()
  })

  it('offers a skip link as the first thing the keyboard reaches', async () => {
    renderApp(fakeClient())
    await screen.findByRole('navigation', { name: 'Sections' })

    await userEvent.tab()

    const skip = screen.getByRole('link', { name: 'Skip to content' })
    expect(document.activeElement).toBe(skip)
    expect(skip.getAttribute('href')).toBe('#main')
    // The target exists, or the link would move focus nowhere.
    expect(document.querySelector('#main')).not.toBeNull()
  })

  it('moves focus through the section links in order', async () => {
    renderApp(fakeClient())
    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    const links = within(nav).getAllByRole('link')

    await userEvent.tab() // skip link
    const reached: string[] = []
    for (let step = 0; step < links.length; step += 1) {
      await userEvent.tab()
      reached.push(document.activeElement?.textContent ?? '')
    }

    // The sections, then the badge: it sits after them in the document and is
    // therefore after them in the tab order, which is where a footer belongs.
    expect(reached).toEqual([...NAVIGATION.map((section) => en[section.labelKey]), ATTRIBUTION.text])
  })

  it('drops the badge only when the server says a licence covers this domain', async () => {
    renderApp(
      fakeClient({
        async getLicense() {
          return { whiteLabel: true, domain: 'example.com' }
        },
      }),
    )

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    await waitFor(() => {
      expect(within(nav).queryByRole('link', { name: ATTRIBUTION.text })).toBeNull()
    })
  })

  it('shows the badge when the licence cannot be read, which is not the same as owning one', async () => {
    // Fails closed. A licence endpoint that is broken must not look like a licence
    // that was bought.
    renderApp(
      fakeClient({
        getLicense: () => never(),
      }),
    )

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    expect(within(nav).getByRole('link', { name: ATTRIBUTION.text })).not.toBeNull()
  })

  it('keeps the sidebar for wide screens and a trigger for narrow ones', async () => {
    // Structural, because jsdom does not evaluate media queries: the layout has
    // to be checked in a browser, which is done separately.
    renderApp(fakeClient())

    const nav = await screen.findByRole('navigation', { name: 'Sections' })
    expect(nav.className).toContain('hidden')
    expect(nav.className).toContain('md:flex')

    const trigger = screen.getByRole('button', { name: 'Open sections' })
    expect(trigger.className).toContain('md:hidden')
  })

  it('opens the sections drawer on a narrow screen', async () => {
    renderApp(fakeClient())

    await userEvent.click(await screen.findByRole('button', { name: 'Open sections' }))

    // The drawer renders a second navigation, this one inside a dialog.
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('navigation', { name: 'Sections' })).toBeTruthy()
  })
})

describe('signing out', () => {
  it('returns to the sign-in screen', async () => {
    renderApp(fakeClient())

    await userEvent.click(await screen.findByRole('button', { name: 'admin' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }))

    expect(await screen.findByLabelText('Password')).toBeTruthy()
  })

  it('still signs out locally when the server cannot be reached', async () => {
    renderApp(
      fakeClient({
        async signOut() {
          throw new ApiError('internal_error', 500)
        },
      }),
    )

    await userEvent.click(await screen.findByRole('button', { name: 'admin' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /sign out/i }))

    expect(await screen.findByLabelText('Password')).toBeTruthy()
  })
})
