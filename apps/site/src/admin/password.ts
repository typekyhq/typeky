import { randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { constantTimeEquals, fromBase64Url, toBase64Url } from './encoding'

/**
 * Password hashing for the single admin account.
 *
 * scrypt, through `node:crypto`, which the `nodejs_compat` flag provides in
 * Workers. Argon2id is the stronger algorithm and section 8 allows it, but every
 * JavaScript implementation ships its WASM as base64 and compiles it at runtime,
 * which workerd refuses outright: "Wasm code generation disallowed by embedder".
 * scrypt is the memory-hard option that actually runs, and it needs no
 * dependency.
 *
 * The cost parameters are stored alongside the hash, so verification follows
 * whatever produced it. Raising them later does not invalidate existing hashes;
 * it takes effect the next time the password is changed.
 */

export interface ScryptParams {
  /** CPU and memory cost. Must be a power of two. */
  N: number
  /** Block size. */
  blockSize: number
  /** Parallelisation. */
  parallelization: number
  /** Derived key length in bytes. */
  keyLength: number
}

/**
 * 16384 costs about 25 ms of CPU and 16 MB of memory in workerd.
 *
 * That is over the 10 ms CPU budget of the Workers free plan, so a login on that
 * plan needs lower parameters -- `pnpm admin:password` takes them. The password
 * hash lives in a Worker secret rather than in the database, and logins are rate
 * limited at the edge, so this cost is defence in depth rather than the only
 * thing standing between an attacker and the account.
 */
export const DEFAULT_SCRYPT_PARAMS: ScryptParams = {
  N: 16_384,
  blockSize: 8,
  parallelization: 1,
  keyLength: 32,
}

const ALGORITHM = 'scrypt'

/** scrypt's own default cap is 32 MB, which N above 16384 exceeds. */
const MAX_MEMORY_BYTES = 128 * 1024 * 1024

function derive(password: string, salt: Uint8Array, params: ScryptParams): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      params.keyLength,
      { N: params.N, r: params.blockSize, p: params.parallelization, maxmem: MAX_MEMORY_BYTES },
      (error, derived) => {
        if (error) reject(error)
        else resolve(Uint8Array.from(derived))
      },
    )
  })
}

/** `scrypt$N$r$p$salt$hash`, all base64url. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT_PARAMS,
): Promise<string> {
  const salt = Uint8Array.from(randomBytes(16))
  const derived = await derive(password, salt, params)

  return [
    ALGORITHM,
    params.N,
    params.blockSize,
    params.parallelization,
    toBase64Url(salt),
    toBase64Url(derived),
  ].join('$')
}

/**
 * Returns false for anything malformed rather than throwing: this runs against a
 * value that comes from configuration, and a bad configuration should deny
 * access, not crash the endpoint.
 */
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const parts = encoded.split('$')
  if (parts.length !== 6 || parts[0] !== ALGORITHM) return false

  const N = Number(parts[1])
  const blockSize = Number(parts[2])
  const parallelization = Number(parts[3])
  if (!Number.isInteger(N) || !Number.isInteger(blockSize) || !Number.isInteger(parallelization)) {
    return false
  }

  const expected = fromBase64Url(parts[5])
  if (expected.length === 0) return false

  const actual = await derive(password, fromBase64Url(parts[4]), {
    N,
    blockSize,
    parallelization,
    keyLength: expected.length,
  })

  return constantTimeEquals(expected, actual)
}
