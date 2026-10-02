/**
 * base64url helpers.
 *
 * Built on the Web `btoa`/`atob` rather than `Buffer`, so the same code runs in a
 * Worker and under Node without a compatibility shim.
 */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array {
  const standard = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = standard.padEnd(Math.ceil(standard.length / 4) * 4, '=')
  const binary = atob(padded)

  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/**
 * Compares two byte strings without leaking where they diverge.
 *
 * A length mismatch returns early, which is fine: the length is not the secret.
 */
export function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false

  let difference = 0
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

/** The same comparison for text, without decoding it first. */
export function constantTimeStringEquals(a: string, b: string): boolean {
  return constantTimeEquals(new TextEncoder().encode(a), new TextEncoder().encode(b))
}
