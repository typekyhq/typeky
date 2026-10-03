// @vitest-environment jsdom
import type { SiteResponse } from '@typeky/api'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { PanelPreferenceProvider, usePanelPreference } from './panel-preference'

/**
 * The panel's preference, from the document to the screen.
 *
 * The settings screen can write the two values, and the formatter can render
 * them; what this checks is the part in between -- that a list reading a
 * timestamp gets the operator's format rather than the default, and that a
 * missing or unreadable document leaves the panel working in English on the
 * default format instead of breaking.
 */

function SITE(admin: Record<string, unknown>): SiteResponse {
  return {
    name: 'Typeky Demo',
    tagline: null,
    logoMediaId: null,
    faviconMediaId: null,
    theme: 'default',
    settings: { admin },
    nav: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  } as SiteResponse
}

/** Stands in for the list column, the editor footer and the theme list. */
function Timestamp() {
  const panel = usePanelPreference()

  return <span data-testid="stamp">{panel.format('2026-01-05T09:07:03.000Z')}</span>
}

function renderWith(site: SiteResponse | 'fails') {
  const client = fakeApiClient({
    async getSite() {
      if (site === 'fails') throw new Error('unreachable')
      return site
    },
  })

  render(
    <ApiClientProvider value={client}>
      <PanelPreferenceProvider>
        <Timestamp />
      </PanelPreferenceProvider>
    </ApiClientProvider>,
  )
}

describe('the panel preference', () => {
  it('uses the configured format once the document has loaded', async () => {
    renderWith(SITE({ dateFormat: '%Y年%-m月%-d日' }))

    // Rendered in the operator's own zone, so the assertion is on the shape the
    // format produces rather than on a fixed instant.
    expect((await screen.findByTestId('stamp')).textContent).toMatch(/^\d{4}年\d{1,2}月\d{1,2}日$/)
  })

  it('falls back to the default format when none is set', async () => {
    renderWith(SITE({}))

    const text = (await screen.findByTestId('stamp')).textContent ?? ''

    expect(text).not.toContain('年')
    expect(text).toMatch(/2026/)
  })

  it('keeps working when the document cannot be read', async () => {
    // A panel that cannot read its own preference is still a panel. The default
    // language and the default format are what it uses, quietly.
    renderWith('fails')

    expect((await screen.findByTestId('stamp')).textContent).toMatch(/2026/)
  })
})
