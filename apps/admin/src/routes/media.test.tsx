// @vitest-environment jsdom
import type { MediaItem } from '@typeky/api'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { ApiError, type ApiClient } from '@/lib/api-client'
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

/**
 * Uploading.
 *
 * The upload endpoint has always taken a filename and an alt text; the screen just
 * never asked. What is worth pinning is that nothing leaves the browser until those
 * two have been offered -- and that a failure does not cost the operator the file
 * they chose.
 */
describe('uploading', () => {
  it('asks for the name and the alt text before it sends anything', async () => {
    const uploadMedia = vi.fn<ApiClient['uploadMedia']>(async () => ITEMS[0]!)
    renderSection(withMedia({ uploadMedia }))

    const file = new File([new Uint8Array([1, 2, 3])], 'IMG_0421.png', { type: 'image/png' })
    await userEvent.upload(await screen.findByLabelText('Choose a file'), file)

    expect(uploadMedia).not.toHaveBeenCalled()
    expect(await screen.findByText('Chosen: IMG_0421.png')).toBeTruthy()
    // The name starts as the file's own, which is usually already right; the alt
    // starts empty, because an alt that repeats the filename helps nobody.
    expect(screen.getByLabelText('File name')).toHaveProperty('value', 'IMG_0421.png')
    expect(screen.getByLabelText('Alt text')).toHaveProperty('value', '')

    await userEvent.clear(screen.getByLabelText('File name'))
    await userEvent.type(screen.getByLabelText('File name'), 'desk.png')
    await userEvent.type(screen.getByLabelText('Alt text'), 'A phone on a desk')
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => {
      expect(uploadMedia).toHaveBeenCalledWith(file, { filename: 'desk.png', alt: 'A phone on a desk' })
    })
  })

  it('keeps what was staged when the upload fails, so a retry is one click', async () => {
    const uploadMedia = vi.fn<ApiClient['uploadMedia']>(async () => {
      throw new ApiError('invalid_request', 400)
    })
    renderSection(withMedia({ uploadMedia }))

    const file = new File([new Uint8Array([1])], 'big.png', { type: 'image/png' })
    await userEvent.upload(await screen.findByLabelText('Choose a file'), file)
    await userEvent.type(screen.getByLabelText('Alt text'), 'A big one')
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(1))
    // Still staged, still typed: pressing Upload again does not mean finding the
    // file again on disk.
    expect(screen.getByText('Chosen: big.png')).toBeTruthy()
    expect(screen.getByLabelText('Alt text')).toHaveProperty('value', 'A big one')

    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))
    await waitFor(() => expect(uploadMedia).toHaveBeenCalledTimes(2))
  })

  it('drops the staged file without uploading it', async () => {
    const uploadMedia = vi.fn<ApiClient['uploadMedia']>(async () => ITEMS[0]!)
    renderSection(withMedia({ uploadMedia }))

    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' })
    await userEvent.upload(await screen.findByLabelText('Choose a file'), file)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Chosen: x.png')).toBeNull()
    expect(uploadMedia).not.toHaveBeenCalled()
  })

  it('falls back to the file name when the name field is cleared', async () => {
    const uploadMedia = vi.fn<ApiClient['uploadMedia']>(async () => ITEMS[0]!)
    renderSection(withMedia({ uploadMedia }))

    const file = new File([new Uint8Array([1])], 'kept.png', { type: 'image/png' })
    await userEvent.upload(await screen.findByLabelText('Choose a file'), file)
    await userEvent.clear(screen.getByLabelText('File name'))
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    // An empty filename in the library is worse than the one the camera wrote, and
    // the control is what knows the original -- so the fallback happens here.
    await waitFor(() => {
      expect(uploadMedia).toHaveBeenCalledWith(file, { filename: 'kept.png', alt: '' })
    })
  })
})
