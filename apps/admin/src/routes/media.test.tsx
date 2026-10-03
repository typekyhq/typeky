// @vitest-environment jsdom
import type { MediaItem } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import type { ApiClient } from '@/lib/api-client'
import { MediaSection } from './media'

/**
 * The media library.
 *
 * Two things here are about seeing rather than managing: the grid shows a crop, and
 * the larger view is where the file is actually looked at. A thumbnail that cannot
 * be opened is a wall of images you have to guess about.
 */

const ITEMS: MediaItem[] = [
  {
    id: 'media_one',
    filename: 'screenshot.png',
    mimeType: 'image/png',
    byteSize: 322 * 1024,
    width: 1440,
    height: 3200,
    altText: 'A tall screenshot',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

function withMedia(overrides: Partial<ApiClient> = {}): ApiClient {
  return fakeApiClient({
    async listMedia() {
      return { items: ITEMS, total: ITEMS.length, limit: 20, offset: 0 }
    },
    ...overrides,
  })
}

function renderSection(client: ApiClient) {
  return render(
    <ApiClientProvider value={client}>
      <MediaSection />
    </ApiClientProvider>,
  )
}

describe('the media library', () => {
  it('lists what the library holds', async () => {
    renderSection(withMedia())

    expect(await screen.findByText('screenshot.png')).toBeTruthy()
    expect(screen.getByText('322 KB · 1440×3200')).toBeTruthy()
  })

  it('opens a larger view when a thumbnail is clicked', async () => {
    renderSection(withMedia())

    const thumbnail = await screen.findByRole('button', { name: 'Look at A tall screenshot' })
    await userEvent.click(thumbnail)

    const viewer = await screen.findByTestId('media-viewer')
    const image = within(viewer).getByRole('img', { name: 'A tall screenshot' })

    // `object-contain` is the promise this view makes: the grid crops, and this is
    // where you see the whole file.
    expect(image.className).toContain('object-contain')
    expect(image.getAttribute('src')).toBe('/api/admin/media/media_one/content')

    // The facts a crop hides, which is the other half of why this view exists.
    expect(within(viewer).getByText('322 KB')).toBeTruthy()
    expect(within(viewer).getByText('1440×3200')).toBeTruthy()
  })

  it('closes the view without touching the library', async () => {
    const deleteMedia = vi.fn(async () => undefined)
    renderSection(withMedia({ deleteMedia }))

    await userEvent.click(await screen.findByRole('button', { name: 'Look at A tall screenshot' }))
    await screen.findByTestId('media-viewer')

    await userEvent.keyboard('{Escape}')

    await waitFor(() => {
      expect(screen.queryByTestId('media-viewer')).toBeNull()
    })
    // Looking is not deleting: the row is still there.
    expect(screen.getByText('screenshot.png')).toBeTruthy()
    expect(deleteMedia).not.toHaveBeenCalled()
  })
})
