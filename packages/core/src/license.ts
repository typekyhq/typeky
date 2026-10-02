/**
 * White-label licences, verified offline.
 *
 * A licence is a signed statement that says "this domain may run without the
 * attribution". It is verified against a public key that ships in this package,
 * so nothing has to be called to check one: an air-gapped deployment, a site on a
 * laptop, and a site behind a firewall all verify the same way, and the checking
 * code cannot fail because somebody else's server is down.
 *
 * The token is two base64url parts joined by a dot: the payload, then a signature
 * over the payload's own bytes. Signing the encoded form rather than the object
 * avoids the question of what canonical JSON is on both sides -- the bytes that
 * were signed are the bytes that were transmitted, and there is nothing to
 * re-serialise before checking.
 *
 * This is deliberately not a JWT. A JWT would be three base64 parts, a header
 * nobody reads, and a library: the only thing this needs from that format is
 * "signed blob", and it gets it in fifteen lines.
 */

import { atob, btoa, crypto, decoder, encoder } from './web'

/**
 * The platform's public key, base64url. The private half never entered the
 * repository and lives outside version control; see CONTRIBUTING.md.
 */
export const TYPEKY_LICENSE_PUBLIC_KEY = '4hfNwfVCuXbaF_vjx5Me5csR7wzmk0rQvEK28lonJx8'

/** Where a licence may be used. `*` means it names no particular site. */
export type LicenseTier = 'single' | 'unlimited'

export interface License {
  /** For a support conversation to name, and for a record of what was issued. */
  id: string
  /** A hostname, or `*` for a licence that is not bound to one. */
  domain: string
  /** ISO 8601. The purchase was a one-off, so this is a record and not an expiry. */
  issuedAt: string
  tier: LicenseTier
}

/**
 * Why a licence was not honoured.
 *
 * These are separate answers because they call for separate actions: a malformed
 * token is a copy-paste accident, a bad signature is a forgery or a corrupted
 * paste, and the wrong domain is a licence being used somewhere it was not sold
 * for. Only the last one is worth a message to the operator rather than to
 * support.
 */
export type LicenseProblem = 'malformed' | 'unknown_key' | 'bad_signature' | 'wrong_domain'

export type LicenseResult =
  | { valid: true; license: License }
  | { valid: false; problem: LicenseProblem; detail?: string }

/**
 * The JSON a signature covers.
 *
 * Key order is fixed here rather than left to `JSON.stringify` of an object built
 * elsewhere, so the bytes signed by the issuing script and the bytes verified by
 * the site are the same bytes by construction.
 */
export function serialiseLicense(license: License): string {
  return JSON.stringify({
    id: license.id,
    domain: license.domain,
    issuedAt: license.issuedAt,
    tier: license.tier,
  })
}

/**
 * The token an operator pastes into their configuration.
 *
 * `signature` is over the payload's own UTF-8 bytes -- the JSON, not its base64.
 * Signing the decoded form is the one that is easy to reason about: the payload
 * in the token decodes to exactly the bytes that were signed, so there is no step
 * where the two sides could disagree about what was covered.
 */
export function formatLicenseToken(payload: string, signature: Uint8Array): string {
  return `${base64UrlEncode(utf8(payload))}.${base64UrlEncode(signature)}`
}

/**
 * Checks a token.
 *
 * `publicKey` exists so a test can supply its own keypair; production always uses
 * the key above. `domain` is the hostname the request arrived on, because the
 * licence is bound to a site rather than to a deployment.
 */
export async function verifyLicense(
  token: string,
  options: { domain: string; publicKey?: string },
): Promise<LicenseResult> {
  const parts = token.trim().split('.')
  if (parts.length !== 2) return { valid: false, problem: 'malformed' }

  const [payloadPart, signaturePart] = parts as [string, string]
  if (payloadPart === '' || signaturePart === '') return { valid: false, problem: 'malformed' }

  const payload = base64UrlDecode(payloadPart)
  const signature = base64UrlDecode(signaturePart)
  if (payload === null || signature === null) return { valid: false, problem: 'malformed' }

  const keyBytes = base64UrlDecode(options.publicKey ?? TYPEKY_LICENSE_PUBLIC_KEY)
  // An Ed25519 public key is 32 bytes and a signature is 64. Checking the lengths
  // first turns a misconfiguration into a named problem instead of an exception
  // from the crypto API.
  if (keyBytes === null || keyBytes.length !== 32) return { valid: false, problem: 'unknown_key' }
  if (signature.length !== 64) return { valid: false, problem: 'malformed' }

  let verified = false
  try {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'Ed25519' }, false, ['verify'])
    verified = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, payload)
  } catch {
    // A runtime without Ed25519 is a reason to refuse the licence, not a reason
    // to fail the request: the site keeps serving, with the attribution.
    return { valid: false, problem: 'unknown_key' }
  }

  if (!verified) return { valid: false, problem: 'bad_signature' }

  const license = parseLicense(payload)
  if (license === null) return { valid: false, problem: 'malformed' }

  if (!domainMatches(license.domain, options.domain)) {
    return { valid: false, problem: 'wrong_domain', detail: license.domain }
  }

  return { valid: true, license }
}

/**
 * Whether a licence for one hostname covers another.
 *
 * Case and port are ignored because neither names a site. A leading `www.` is
 * ignored too, and that is the only pairing of names treated as one site: an
 * operator who bought a licence for `example.com` and put it behind
 * `blog.example.com` has two sites, and the licence says so.
 */
export function domainMatches(licensed: string, requested: string): boolean {
  if (licensed === '*') return true

  return normaliseDomain(licensed) === normaliseDomain(requested)
}

function normaliseDomain(value: string): string {
  return value.trim().toLowerCase().replace(/:\d+$/, '').replace(/^www\./, '')
}

function parseLicense(bytes: Uint8Array): License | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(bytes))
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null

  const candidate = parsed as Record<string, unknown>
  const { id, domain, issuedAt, tier } = candidate

  if (typeof id !== 'string' || id === '') return null
  if (typeof domain !== 'string' || domain === '') return null
  if (typeof issuedAt !== 'string' || Number.isNaN(Date.parse(issuedAt))) return null
  if (tier !== 'single' && tier !== 'unlimited') return null

  return { id, domain, issuedAt, tier }
}

/* ---------------------------------------------------------------- base64url -- */

function utf8(value: string): Uint8Array {
  return encoder.encode(value)
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlDecode(value: string): Uint8Array | null {
  // `atob` is lenient about some malformed input, so the shape is checked before
  // it is handed anything: a signature that was mangled in a paste should be
  // reported as malformed rather than silently half-decoded.
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null

  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4)

  try {
    const binary = atob(withPadding)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)

    return bytes
  } catch {
    return null
  }
}
