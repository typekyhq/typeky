// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { SignInScreen } from './sign-in-screen'

/**
 * What the sign-in screen says about the site.
 *
 * The site document is behind the session, so the name and logo come from one
 * public endpoint -- and a deployment that has neither, or cannot reach it, still
 * has to render a screen that says what it is.
 */

function renderScreen(client = fakeApiClient()): void {
  render(
    <ApiClientProvider value={client}>
      <SignInScreen onSubmit={async () => undefined} />
    </ApiClientProvider>,
  )
}

describe('the sign-in screen', () => {
  it('shows the site logo, with the site name as its alt', async () => {
    renderScreen(
      fakeApiClient({
        async readBranding() {
          return { name: 'Typeky Demo', logoUrl: 'https://example.com/media/logo_1' }
        },
      }),
    )

    const logo = await screen.findByTestId('sign-in-logo')

    expect(logo.getAttribute('src')).toBe('https://example.com/media/logo_1')
    // The name, not the word "logo": a screen reader reads the name out, and a logo
    // is a picture of the name.
    expect(logo.getAttribute('alt')).toBe('Typeky Demo')
    expect(screen.getByText('Typeky Demo')).toBeTruthy()
  })

  it('names the platform when the site has no logo', async () => {
    renderScreen()

    // No logo, and no empty <img> either: the panel's own name is what a deployment
    // without branding shows.
    expect(await screen.findByText('Typeky')).toBeTruthy()
    expect(screen.queryByTestId('sign-in-logo')).toBeNull()
  })

  it('still says what it is when the branding cannot be read', async () => {
    renderScreen(
      fakeApiClient({
        async readBranding() {
          throw new Error('offline')
        },
      }),
    )

    expect(await screen.findByText('Typeky admin')).toBeTruthy()
    expect(screen.queryByTestId('sign-in-logo')).toBeNull()
  })
})
