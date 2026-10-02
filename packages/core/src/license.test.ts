import { describe, expect, it } from 'vitest'
import { crypto, decoder, encoder } from './web'
import {
  base64UrlDecode,
  base64UrlEncode,
  domainMatches,
  formatLicenseToken,
  serialiseLicense,
  verifyLicense,
  TYPEKY_LICENSE_PUBLIC_KEY,
  type License,
} from './license'

/**
 * Offline licence verification.
 *
 * Nothing here uses the platform's real keypair, and that is deliberate: a test
 * that signed with the production key would need the private half, and the
 * private half not being available to the tests is the property worth keeping.
 * Each test makes a keypair, signs, and verifies -- which is also the only way to
 * check the two halves of the format actually agree.
 *
 * One assertion does read the real public key, because a placeholder that was
 * never replaced would otherwise pass every test in this file.
 */

/** A keypair whose `sign` works, and which turns a licence into a token. */
async function signer(): Promise<{ publicKey: string; token: (license: License) => Promise<string> }> {
  const pair = await signing.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const raw = new Uint8Array(await signing.subtle.exportKey('raw', pair.publicKey))

  return {
    publicKey: base64UrlEncode(raw),
    async token(license) {
      const payload = serialiseLicense(license)
      const signature = new Uint8Array(
        await signing.subtle.sign({ name: 'Ed25519' }, pair.privateKey, encoder.encode(payload)),
      )

      return formatLicenseToken(payload, signature)
    },
  }
}

/**
 * The signing half of WebCrypto, which only the tests use.
 *
 * Production verifies and never signs -- the private key is not in the repository
 * -- so this view of the same global lives here rather than in the package, and
 * says so.
 */
interface SigningKeypair {
  publicKey: unknown
  privateKey: unknown
}

const signing = crypto as unknown as {
  subtle: {
    generateKey(algorithm: { name: string }, extractable: boolean, usages: string[]): Promise<SigningKeypair>
    exportKey(format: 'raw', key: unknown): Promise<ArrayBuffer>
    sign(algorithm: { name: string }, key: unknown, data: Uint8Array): Promise<ArrayBuffer>
  }
}

const LICENSE: License = {
  id: 'TY-0001',
  domain: 'example.com',
  issuedAt: '2026-01-01T00:00:00.000Z',
  tier: 'single',
}

describe('a licence that was issued properly', () => {
  it('verifies, and reports what it said', async () => {
    const { publicKey, token } = await signer()

    const result = await verifyLicense(await token(LICENSE), { domain: 'example.com', publicKey })

    expect(result).toEqual({ valid: true, license: LICENSE })
  })

  it('verifies a token that came through a paste with whitespace around it', async () => {
    const { publicKey, token } = await signer()

    const result = await verifyLicense(`  ${await token(LICENSE)}\n`, { domain: 'example.com', publicKey })

    expect(result.valid).toBe(true)
  })
})

describe('a licence that was tampered with', () => {
  it('fails when the payload is edited, because the signature covers it', async () => {
    const { publicKey, token } = await signer()
    const issued = await token(LICENSE)

    // The forgery: keep the signature, claim a different domain.
    const [payload, signature] = issued.split('.')
    const edited = JSON.parse(decoder.decode(base64UrlDecode(payload ?? '') ?? new Uint8Array())) as License
    edited.domain = 'somebody-elses-site.com'
    const forged = `${base64UrlEncode(encoder.encode(serialiseLicense(edited)))}.${signature ?? ''}`

    const result = await verifyLicense(forged, { domain: 'somebody-elses-site.com', publicKey })

    expect(result).toEqual({ valid: false, problem: 'bad_signature' })
  })

  it('fails when the signature is edited', async () => {
    const { publicKey, token } = await signer()
    const [payload] = (await token(LICENSE)).split('.')

    const flipped = new Uint8Array(64).fill(7)
    const result = await verifyLicense(`${payload ?? ''}.${base64UrlEncode(flipped)}`, {
      domain: 'example.com',
      publicKey,
    })

    expect(result).toEqual({ valid: false, problem: 'bad_signature' })
  })

  it('fails when it was signed by somebody else', async () => {
    const mine = await signer()
    const theirs = await signer()

    const result = await verifyLicense(await theirs.token(LICENSE), { domain: 'example.com', publicKey: mine.publicKey })

    expect(result).toEqual({ valid: false, problem: 'bad_signature' })
  })
})

describe('a licence that is not a licence', () => {
  it.each([
    ['', 'an empty string'],
    ['not-a-token', 'no separator'],
    ['a.b.c', 'too many parts'],
    ['.', 'two empty parts'],
    ['!!!.!!!', 'characters that are not base64url'],
  ])('answers malformed for %s', async (token) => {
    const { publicKey } = await signer()

    const result = await verifyLicense(token, { domain: 'example.com', publicKey })

    expect(result.valid).toBe(false)
    expect((result as { problem: string }).problem).toBe('malformed')
  })

  it('answers malformed when the payload is not the shape it claims', async () => {
    const pair = await signing.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const raw = new Uint8Array(await signing.subtle.exportKey('raw', pair.publicKey))

    // Correctly signed, but the payload is not a licence: signing something does
    // not make it true.
    const payload = JSON.stringify({ id: 'TY-0001', domain: 'example.com' })
    const signature = new Uint8Array(
      await signing.subtle.sign({ name: 'Ed25519' }, pair.privateKey, encoder.encode(payload)),
    )

    const result = await verifyLicense(formatLicenseToken(payload, signature), {
      domain: 'example.com',
      publicKey: base64UrlEncode(raw),
    })

    expect(result).toEqual({ valid: false, problem: 'malformed' })
  })
})

describe('the domain a licence is bound to', () => {
  it('refuses a licence issued for somewhere else, and says where', async () => {
    const { publicKey, token } = await signer()

    const result = await verifyLicense(await token(LICENSE), { domain: 'not-example.com', publicKey })

    // `detail` is what lets the operator be told which site the licence names,
    // which is the difference between a puzzle and an answer.
    expect(result).toEqual({ valid: false, problem: 'wrong_domain', detail: 'example.com' })
  })

  it('is compared without case, port, or a leading www', () => {
    expect(domainMatches('example.com', 'EXAMPLE.com')).toBe(true)
    expect(domainMatches('example.com', 'example.com:8787')).toBe(true)
    expect(domainMatches('example.com', 'www.example.com')).toBe(true)
    expect(domainMatches('www.example.com', 'example.com')).toBe(true)
  })

  it('does not treat a subdomain as the same site', () => {
    // The single-site licence is for one site. An operator who bought
    // example.com and deployed to blog.example.com has two.
    expect(domainMatches('example.com', 'blog.example.com')).toBe(false)
    expect(domainMatches('example.com', 'example.com.evil.test')).toBe(false)
  })

  it('matches anything when it names no site', () => {
    const unlimited = { ...LICENSE, domain: '*', tier: 'unlimited' as const }

    expect(domainMatches(unlimited.domain, 'anywhere.example')).toBe(true)
  })
})

describe('the platform public key', () => {
  it('is a real Ed25519 key and not the empty placeholder', () => {
    // An empty constant would make every verification answer `unknown_key`, which
    // every other test in this file would still pass.
    expect(TYPEKY_LICENSE_PUBLIC_KEY).not.toBe('')
    expect(base64UrlDecode(TYPEKY_LICENSE_PUBLIC_KEY)?.length).toBe(32)
  })

  it('is reported as unknown_key when it cannot be used', async () => {
    const { token } = await signer()

    const result = await verifyLicense(await token(LICENSE), { domain: 'example.com', publicKey: '' })

    expect(result).toEqual({ valid: false, problem: 'unknown_key' })
  })
})

describe('the sign-and-verify loop', () => {
  it('round-trips a payload through base64url unchanged', () => {
    const payload = serialiseLicense(LICENSE)

    expect(decoder.decode(base64UrlDecode(base64UrlEncode(encoder.encode(payload))) ?? new Uint8Array())).toBe(
      payload,
    )
  })

  it('covers the bytes that were transmitted, not a re-serialisation of them', async () => {
    // The property that makes the format safe: signing the decoded JSON means
    // there is no step where two implementations could disagree about which bytes
    // a signature was over. Spacing inside the JSON survives verification because
    // the signature is over that exact string.
    const pair = await signing.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const raw = new Uint8Array(await signing.subtle.exportKey('raw', pair.publicKey))

    const spaced = `{ "id" : "TY-0001" ,\n  "domain": "example.com",\n  "issuedAt": "2026-01-01T00:00:00.000Z",\n  "tier": "single" }`
    const signature = new Uint8Array(
      await signing.subtle.sign({ name: 'Ed25519' }, pair.privateKey, encoder.encode(spaced)),
    )

    const result = await verifyLicense(formatLicenseToken(spaced, signature), {
      domain: 'example.com',
      publicKey: base64UrlEncode(raw),
    })

    expect(result.valid).toBe(true)
  })
})
