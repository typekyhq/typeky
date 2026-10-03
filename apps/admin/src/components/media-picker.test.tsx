// @vitest-environment jsdom
import type { MediaItem } from '@typeky/api'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { ApiClient } from '@/lib/api-client'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { MediaPicker } from './media-picker'

const ITEMS: MediaItem[] = [
  {
    id: 'media_one',
    filename: 'lamp.png',
    mimeType: 'image/png',
    byteSize: 2048,
    width: 800,
    height: 600,
    altText: 'A lamp',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
]

function renderPicker(client: ApiClient, onSelect = vi.fn()) {
  return render(
    <ApiClientProvider value={client}>
      <MediaPicker open onOpenChange={() => undefined} onSelect={onSelect} />
    </ApiClientProvider>,
  )
}

describe('the media picker', () => {
  it('offers what is already there, and hands back the choice', async () => {
    const onSelect = vi.fn()
    renderPicker(
      fakeApiClient({
        async listMedia() {
          return { items: ITEMS, total: 1, limit: 24, offset: 0 }
        },
      }),
      onSelect,
    )

    await userEvent.click(await screen.findByRole('button', { name: /lamp\.png/ }))

    expect(onSelect).toHaveBeenCalledWith(ITEMS[0])
  })

  it('searches', async () => {
    const listMedia = vi.fn(async () => ({ items: ITEMS, total: 1, limit: 24, offset: 0 }))
    renderPicker(fakeApiClient({ listMedia }))

    await screen.findByRole('button', { name: /lamp\.png/ })
    await userEvent.type(screen.getByLabelText('Search'), 'lamp')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    await waitFor(() => {
      expect(listMedia).toHaveBeenLastCalledWith(expect.objectContaining({ search: 'lamp' }))
    })
  })

  it('says when there is nothing yet rather than showing an empty grid', async () => {
    renderPicker(
      fakeApiClient({
        async listMedia() {
          return { items: [], total: 0, limit: 24, offset: 0 }
        },
      }),
    )

    expect(await screen.findByText('No media yet. Upload the first one above.')).toBeTruthy()
  })

  it('uploads a file and hands back the new item, so the field is filled at once', async () => {
    const uploaded: MediaItem = { ...ITEMS[0]!, id: 'media_new', filename: 'new.png' }
    const onSelect = vi.fn()
    const uploadMedia = vi.fn(async () => uploaded)

    renderPicker(
      fakeApiClient({
        async listMedia() {
          return { items: [], total: 0, limit: 24, offset: 0 }
        },
        uploadMedia,
      }),
      onSelect,
    )

    const file = new File([new Uint8Array([1, 2, 3])], 'new.png', { type: 'image/png' })
    await userEvent.upload(await screen.findByLabelText('Choose a file'), file)

    // Staged, not sent: the two things an upload needs to be told are the filename
    // and the alt text, and neither is something the file picker asked for.
    expect(uploadMedia).not.toHaveBeenCalled()
    expect(await screen.findByText('Chosen: new.png')).toBeTruthy()

    // The name starts as the file's own; the alt starts empty, because an alt that
    // repeats the filename helps nobody.
    expect(screen.getByLabelText('File name')).toHaveProperty('value', 'new.png')
    expect(screen.getByLabelText('Alt text')).toHaveProperty('value', '')

    await userEvent.clear(screen.getByLabelText('File name'))
    await userEvent.type(screen.getByLabelText('File name'), 'holiday.png')
    await userEvent.type(screen.getByLabelText('Alt text'), 'A beach at sunset')
    await userEvent.click(screen.getByRole('button', { name: 'Upload' }))

    await waitFor(() => {
      expect(uploadMedia).toHaveBeenCalledWith(file, { filename: 'holiday.png', alt: 'A beach at sunset' })
    })
    await waitFor(() => {
      expect(onSelect).toHaveBeenCalledWith(uploaded)
    })
  })
})
