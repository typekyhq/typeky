// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ApiClientProvider } from '@/lib/client-context'
import { fakeApiClient } from '@/lib/testing'
import { LicensePanel } from './license-panel'

/**
 * The licence panel.
 *
 * This is the surface the slice's "a wrong domain is reported, not fatal" actually
 * reaches a person through. What is worth fixing in a test is that the three
 * states read as three different things -- otherwise an operator cannot tell
 * "not bought" from "bought and not working here", which are the two cases that
 * call for opposite actions.
 */

function renderPanel(
  getLicense: () => Promise<{
    whiteLabel: boolean
    domain: string
    license?: { id: string; domain: string; issuedAt: string; tier: string }
    problem?: string
    licensedDomain?: string
  }>,
) {
  render(
    <ApiClientProvider value={fakeApiClient({ getLicense })}>
      <LicensePanel />
    </ApiClientProvider>,
  )
}

describe('a free deployment', () => {
  it('says there is no licence, in the language of information', async () => {
    renderPanel(async () => ({ whiteLabel: false, domain: 'example.com' }))

    expect(await screen.findByText(/None. The site’s footer says/)).toBeTruthy()
  })
})

describe('an active licence', () => {
  it('names the domain it covers', async () => {
    renderPanel(async () => ({
      whiteLabel: true,
      domain: 'example.com',
      license: { id: 'TY-0001', domain: 'example.com', issuedAt: '2026-01-01T00:00:00.000Z', tier: 'single' },
    }))

    // One sentence rather than spans around the parts: a translator needs the
    // whole sentence, and a sentence assembled from fragments is a sentence that
    // only works in the language it was written in.
    expect(await screen.findByText(/Active for example\.com, issued 2026-01-01 \(single\)/)).toBeTruthy()
  })
})

describe('a licence that does not apply here', () => {
  it('names both domains, and says the site is fine', async () => {
    renderPanel(async () => ({
      whiteLabel: false,
      domain: 'www.example.com',
      problem: 'wrong_domain',
      licensedDomain: 'other.example',
    }))

    // Both halves of the puzzle: what was asked, and what the licence says. One
    // without the other is a support ticket.
    expect(await screen.findByText(/does not apply here/)).toBeTruthy()
    expect(screen.getByText(/arrived as www\.example\.com, and the licence names other\.example/)).toBeTruthy()
    expect(screen.getByText(/keeps serving, with the attribution on it/)).toBeTruthy()
  })

  it('explains a signature failure without blaming the operator', async () => {
    renderPanel(async () => ({ whiteLabel: false, domain: 'example.com', problem: 'bad_signature' }))

    expect(await screen.findByText(/edited, truncated, or not issued by us/)).toBeTruthy()
  })

  it('falls back to the code for a reason it does not know', async () => {
    // A reason added on the server should read as an unfamiliar word rather than
    // as the wrong explanation.
    renderPanel(async () => ({ whiteLabel: false, domain: 'example.com', problem: 'a-new-reason' }))

    expect(await screen.findByText(/refused because a-new-reason/)).toBeTruthy()
  })
})
