import { base64UrlEncode, formatLicenseToken, serialiseLicense, type License } from '@typeky/core'
import { describe, expect, it, vi } from 'vitest'
import { licenseState, licenseStateFor } from './license'
import { makeTestEnv } from './testing/env'

/**
 * The white-label switch.
 *
 * Two properties matter and both are about what happens when things are wrong.
 * A licence that does not verify leaves a working site with the badge on it --
 * there is no path here that throws, and no path that removes the badge without
 * a signature saying it may. And a deployment with no licence at all is the
 * ordinary state, not a problem to report.
 */

/**
 * The signing half of WebCrypto, which only the tests use.
 *
 * Production verifies and never signs -- the private key is not in the repository
 * -- so the narrow view of the same global lives in the test rather than in the
 * package. The site's lib types model `generateKey` as returning either a key or a
 * keypair, because the answer depends on the algorithm; Ed25519 is a keypair, and
 * saying so once here beats a cast at every call.
 */
const signing = crypto as unknown as {
  subtle: {
    generateKey(algorithm: { name: string }, extractable: boolean, usages: string[]): Promise<CryptoKeyPair>
    exportKey(format: 'raw', key: CryptoKey): Promise<ArrayBuffer>
    sign(algorithm: { name: string }, key: CryptoKey, data: Uint8Array): Promise<ArrayBuffer>
  }
}

/** A keypair, and the ability to mint a token with it. */
async function authority() {
  const pair = await signing.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const publicKey = base64UrlEncode(new Uint8Array(await signing.subtle.exportKey('raw', pair.publicKey)))

  return {
    publicKey,
    async token(license: License) {
      const payload = serialiseLicense(license)
      const signature = new Uint8Array(
        await signing.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(payload)),
      )

      return formatLicenseToken(payload, signature)
    },
  }
}

const LICENSE: License = {
  id: 'TY-0001',
  domain: 'example.com',
  issuedAt: '2026-01-01T00:00:00.000Z',
  tier: 'single',
}

describe('a deployment with no licence', () => {
  it('is free, and says nothing about it', async () => {
    // The ordinary state. No key, no warning, no problem to report.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const state = await licenseState(makeTestEnv(), 'example.com')

    expect(state).toEqual({ whiteLabel: false })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it('treats an empty key as no key rather than as a broken one', async () => {
    expect(await licenseState(makeTestEnv({ LICENSE_KEY: '   ' }), 'example.com')).toEqual({ whiteLabel: false })
  })
})

describe('a licence that verifies', () => {
  it('turns the attribution off, and reports what it was', async () => {
    const { publicKey, token } = await authority()

    const state = await licenseStateFor(await token(LICENSE), 'example.com', publicKey)

    expect(state).toEqual({ whiteLabel: true, license: LICENSE })
    // No warning: verifying is not news.
    expect(state.problem).toBeUndefined()
  })

  it('covers the domain it names, however it was written', async () => {
    const { publicKey, token } = await authority()

    expect((await licenseStateFor(await token(LICENSE), 'www.example.com:8787', publicKey)).whiteLabel).toBe(true)
  })
})

describe('a licence that does not verify', () => {
  it('leaves the site free and says which domain it names', async () => {
    const { publicKey, token } = await authority()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const state = await licenseStateFor(await token(LICENSE), 'somebody-else.com', publicKey)

    // Note what this is not: it is not an error, not a throw, and not a page
    // that fails to render. The site works and the badge stays.
    expect(state).toEqual({ whiteLabel: false, problem: 'wrong_domain', licensedDomain: 'example.com' })
    expect(warn).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('leaves the site free when the signature does not hold', async () => {
    const mine = await authority()
    const theirs = await authority()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    const state = await licenseStateFor(await theirs.token(LICENSE), 'example.com', mine.publicKey)

    expect(state).toEqual({ whiteLabel: false, problem: 'bad_signature' })
    warn.mockRestore()
  })

  it('leaves the site free when the token is not a token', async () => {
    const { publicKey } = await authority()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    expect(await licenseStateFor('not-a-licence', 'example.com', publicKey)).toEqual({
      whiteLabel: false,
      problem: 'malformed',
    })
    warn.mockRestore()
  })

  it('never removes the attribution without a signature to say so', async () => {
    // The one property the whole mechanism rests on, stated as a test: for every
    // refusal, the answer is "show the badge".
    const { publicKey } = await authority()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    for (const token of ['', 'x', 'a.b', 'a.b.c', 'eyJhIjoxfQ.AAAA']) {
      const state = await licenseStateFor(token, 'example.com', publicKey)
      expect(state.whiteLabel).toBe(false)
    }

    warn.mockRestore()
  })
})
