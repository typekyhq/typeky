// @vitest-environment jsdom
import type { SeoMetadata } from '@typeky/api'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { SeoPanel } from './seo-panel'

function renderPanel(value: SeoMetadata, onChange = vi.fn()) {
  render(
    <ApiClientProvider value={fakeApiClient()}>
      <SeoPanel idPrefix="t" value={value} onChange={onChange} fallback="Left empty, the defaults are used." />
    </ApiClientProvider>,
  )

  return onChange
}

/** Opens the disclosure. Closed by default, which is the point. */
async function open() {
  await userEvent.click(screen.getByText('Search and sharing'))
}

describe('the SEO panel', () => {
  it('shows its fields and says how many have been set', () => {
    render(
      <ApiClientProvider value={fakeApiClient()}>
        <SeoPanel idPrefix="t" value={{}} onChange={() => undefined} fallback="x" />
      </ApiClientProvider>,
    )

    // This panel used to be a `<details>` that opened on demand. It is a tab of
    // the editor now, so being hidden is the tab's job and the fields are simply
    // here -- with the one line the collapsed summary used to say.
    expect(screen.getByText('using the defaults')).toBeTruthy()
    expect(screen.getByLabelText('Meta title')).toBeTruthy()
    expect(screen.getByLabelText('Meta description')).toBeTruthy()
    expect(screen.getByLabelText('Canonical URL')).toBeTruthy()
    expect(screen.getByLabelText('Social image')).toBeTruthy()
  })

  it('says how many fields are overridden', () => {
    renderPanel({ title: 'Custom', canonical: 'https://example.com/a' })

    expect(screen.getByText('2 overridden')).toBeTruthy()
  })

  it('writes a field', async () => {
    const onChange = renderPanel({})
    await open()

    await userEvent.type(screen.getByLabelText('Meta title'), 'A')

    expect(onChange).toHaveBeenLastCalledWith({ title: 'A' })
  })

  it('removes a field when it is cleared, rather than storing an empty string', async () => {
    // The contract distinguishes "absent" from "empty": an absent description
    // means derive one, and an empty one means the author cleared it.
    const onChange = renderPanel({ description: 'Something' })
    await open()

    await userEvent.clear(screen.getByLabelText('Meta description'))

    await vi.waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({})
    })
    expect(Object.keys(onChange.mock.calls.at(-1)?.[0] as object)).toEqual([])
  })

  it('keeps the other fields when one changes', async () => {
    const onChange = renderPanel({ title: 'Kept', canonical: 'https://example.com/a' })
    await open()

    await userEvent.type(screen.getByLabelText('Meta description'), 'D')

    expect(onChange).toHaveBeenLastCalledWith({
      title: 'Kept',
      canonical: 'https://example.com/a',
      description: 'D',
    })
  })

  it('shows a validation error on the field that caused it', async () => {
    render(
      <ApiClientProvider value={fakeApiClient()}>
        <SeoPanel
          idPrefix="t"
          value={{}}
          onChange={() => undefined}
          issues={{ 'seo.canonical': 'Too long' }}
          fallback="x"
        />
      </ApiClientProvider>,
    )
    await open()

    expect(screen.getByText('Too long')).toBeTruthy()
    expect(screen.getByLabelText('Canonical URL').getAttribute('aria-invalid')).toBe('true')
  })
})
