// @vitest-environment jsdom
import type { SiteResponse } from '@typeky/api'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiClientProvider } from '@/lib/client-context'
import { PanelPreferenceProvider } from '@/lib/panel-preference'
import { fakeApiClient } from '@/lib/testing'
import type { ApiClient } from '@/lib/api-client'
import { AdminBrand } from './admin-brand'

/**
 * What the panel calls itself.
 *
 * The logo comes from the site document, so these go through the real preference
 * provider rather than a stubbed context: the path from "the site has a logo" to
 * "the sidebar shows it" is three steps, and a test that hands the component a
 * ready-made brand would be testing none of them.
 */

function withSite(overrides: Partial<SiteResponse> = {}): ApiClient {
  return fakeApiClient({
    async getSite() {
      return {
        name: 'NexusCloud',
        tagline: null,
        logoMediaId: null,
        faviconMediaId: null,
        theme: 'default',
        settings: {},
        nav: [],
        updatedAt: '2026-01-01T00:00:00.000Z',
        ...overrides,
      }
    },
  })
}

function renderBrand(client: ApiClient) {
  return render(
    <ApiClientProvider value={client}>
      <PanelPreferenceProvider>
        <AdminBrand />
      </PanelPreferenceProvider>
    </ApiClientProvider>,
  )
}

describe('the panel brand', () => {
  it("shows the site's logo when it has one", async () => {
    renderBrand(withSite({ logoMediaId: 'media_logo' }))

    const logo = (await screen.findByTestId('admin-brand-logo')) as HTMLImageElement

    // Served by the panel's own media route, which is the one that exists before the
    // public site is published.
    expect(logo.getAttribute('src')).toBe('/api/admin/media/media_logo/content')
    // The name is what the logo stands for, and a screen reader has nothing else.
    expect(logo.getAttribute('alt')).toBe('NexusCloud')
  })

  it('shows the platform name when the site has no logo yet', async () => {
    renderBrand(withSite())

    // Not a blank slot: a deployment that has not been branded says which software
    // it is, and that is the state every deployment starts in.
    await waitFor(() => {
      expect(screen.getByText('Typeky')).toBeTruthy()
    })
    expect(screen.queryByTestId('admin-brand-logo')).toBeNull()
  })

  it('shows the platform name when the panel cannot read the site at all', async () => {
    renderBrand(
      fakeApiClient({
        async getSite(): Promise<SiteResponse> {
          throw new Error('not signed in')
        },
      }),
    )

    await waitFor(() => {
      expect(screen.getByText('Typeky')).toBeTruthy()
    })
  })
})
