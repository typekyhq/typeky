/**
 * UUIDv7 identifiers.
 *
 * Generated in the application rather than by a database function, so SQLite and
 * PostgreSQL produce identical ids and no dialect-specific default is needed
 * (architecture section 5.2).
 *
 * Layout: a 48-bit millisecond timestamp followed by 74 bits of randomness, so
 * ids sort by creation time as plain strings -- which is what lets a primary key
 * double as a stable tie-breaker in ordered queries.
 */

/** Random bits: 12 for rand_a, 62 for rand_b. Held as 9 bytes, or 18 hex chars. */
const RANDOM_BYTES = 9

/** Marks this as a version 7 UUID. */
const VERSION_NIBBLE = '7'

/** Bits 6 and 7 of the variant field, so the first hex digit lands in 8..b. */
const VARIANT_BASE = 0x8

let lastMillisecond = 0
let lastRandom: Uint8Array<ArrayBuffer> | undefined

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** Counts a big-endian byte array up by one, in place. */
function increment(bytes: Uint8Array): void {
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    if (bytes[index] === 0xff) {
      bytes[index] = 0
      continue
    }
    bytes[index] += 1
    return
  }
}

/**
 * @param now Millisecond timestamp. Injectable so tests can pin time.
 */
export function uuidv7(now: number = Date.now()): string {
  let random: Uint8Array<ArrayBuffer>

  if (now === lastMillisecond && lastRandom !== undefined) {
    // Same millisecond as the previous id: count up instead of drawing fresh
    // randomness, so a burst of inserts still comes out in creation order.
    random = Uint8Array.from(lastRandom)
    increment(random)
  } else {
    random = new Uint8Array(RANDOM_BYTES)
    crypto.getRandomValues(random)
  }

  lastMillisecond = now
  lastRandom = random

  const hex = toHex(random)
  const milliseconds = now.toString(16).padStart(12, '0').slice(-12)
  const variantDigit = (VARIANT_BASE | (Number.parseInt(hex[0], 16) & 0x3)).toString(16)

  return [
    milliseconds.slice(0, 8),
    milliseconds.slice(8, 12),
    `${VERSION_NIBBLE}${hex.slice(0, 3)}`,
    `${variantDigit}${hex.slice(3, 6)}`,
    hex.slice(6, 18),
  ].join('-')
}

/** True when the value has the UUIDv7 shape this module produces. */
export function isUuidV7(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}
