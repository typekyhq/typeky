// @vitest-environment jsdom
import type { ThemeContextResponse } from '@typeky/api'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import type { ApiClient } from '@/lib/api-client'
import { TemplateReference } from './template-reference'

/**
 * The reference an author reads.
 *
 * What it shows comes from the server, so what is worth testing here is the
 * grouping and what a group is called -- including a group nobody has named yet,
 * because the whole point of deriving the list is that it grows without anybody
 * editing this component.
 */

const REFERENCE: ThemeContextResponse = {
  template: 'templates/page',
  paths: [
    'content.blocks',
    'content.title',
    // A group with no translation, which is what a field the platform gains later
    // looks like from here.
    'custom.thing',
    'page.kind',
    'preview',
    'seo.title',
    'site.name',
  ],
  tags: ['for', 'if', 'render'],
  platformFilters: ['asset_url', 'render_blocks'],
  nativeFilters: ['date', 'default'],
}

function renderReference(client: ApiClient) {
  return render(
    <ApiClientProvider value={client}>
      <TemplateReference template="templates/page" />
    </ApiClientProvider>,
  )
}

function withReference(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeApiClient({
    async getThemeContext() {
      return REFERENCE
    },
    ...overrides,
  })
}

describe('the template reference', () => {
  it('is a disclosure that starts closed', () => {
    const { container } = renderReference(withReference())

    // A reference that takes a third of the screen is one that gets in the way of
    // the thing it is about.
    expect(container.querySelector('details')?.open).toBe(false)
    expect(screen.getByText('Available template tags')).toBeTruthy()
  })

  it('lists the fields, the tags and the filters', async () => {
    const { container } = renderReference(withReference())
    const panel = await screen.findByTestId('template-reference')

    // The paths are named in full: `site.name` is what an author writes, and the
    // heading above it is a heading rather than a prefix to assemble.
    expect(within(panel).getByText('site.name')).toBeTruthy()
    expect(within(panel).getByText('content.blocks')).toBeTruthy()
    expect(within(panel).getByText('render')).toBeTruthy()
    expect(within(panel).getByText('render_blocks')).toBeTruthy()
    expect(within(panel).getByText('date')).toBeTruthy()

    expect(container.querySelectorAll('code').length).toBe(
      REFERENCE.paths.length +
        REFERENCE.tags.length +
        REFERENCE.platformFilters.length +
        REFERENCE.nativeFilters.length,
    )
  })

  it('names the groups it knows', async () => {
    renderReference(withReference())

    const panel = await screen.findByTestId('template-reference')

    expect(within(panel).getByText('Site')).toBeTruthy()
    expect(within(panel).getByText('The content')).toBeTruthy()
    expect(within(panel).getByText('Search and sharing')).toBeTruthy()
  })

  it('shows a group it has no translation for under its own name', async () => {
    renderReference(withReference())

    const panel = await screen.findByTestId('template-reference')

    // Showing `templateReference.group.custom` would be showing a key instead of a
    // word, which is worse than showing the key's own first segment.
    expect(within(panel).getByText('custom')).toBeTruthy()
    expect(within(panel).queryByText('templateReference.group.custom')).toBeNull()
  })

  it('says so when the reference cannot be loaded', async () => {
    renderReference(
      withReference({
        async getThemeContext() {
          throw new Error('the reference is unavailable')
        },
      }),
    )

    // The error path shows the API's own message, which is what an operator can act
    // on; the panel is a convenience and must not take the editor down with it.
    expect(await screen.findByText(/unavailable|went wrong/)).toBeTruthy()
  })
})
