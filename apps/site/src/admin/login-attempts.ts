/**
 * How many wrong passwords one client may try, and how long it waits after that.
 *
 * scrypt already makes each attempt cost real CPU, so this is not what makes
 * guessing *expensive* -- it is what stops a script from guessing forever at a URL
 * it already knows. The two are complementary: the hash is the floor under a
 * single attempt, and this is the ceiling on how many attempts there are.
 *
 * The counter lives in KV, which architecture section 8 allows for exactly this
 * kind of record: it is self-contained, it can be rebuilt by waiting, and losing it
 * costs nothing but the window.
 *
 * The window is **fixed**, not sliding: KV's expiry is set when the first failure
 * is written, and later failures do not extend it. A client that keeps guessing
 * therefore gets a fresh five attempts every window rather than being locked out
 * indefinitely -- which is the right trade for a single account whose owner can
 * mistype a password.
 */

/** Wrong passwords one client may try inside one window. */
export const MAX_LOGIN_FAILURES = 5

/** The window, in seconds. KV expires the counter at the end of it. */
export const LOGIN_WINDOW_SECONDS = 15 * 60

const KEY_PREFIX = 'login-fail:'

/**
 * Which client this is.
 *
 * `CF-Connecting-IP` is set by Cloudflare and cannot be spoofed by the caller, so
 * it is the only header trusted on its own. `x-forwarded-for` is read next because
 * a deployment behind another proxy is a real configuration; a request with
 * neither shares one counter, which errs towards locking out rather than towards
 * letting a script through.
 */
export function loginClientKey(request: Request): string {
  const connecting = request.headers.get('cf-connecting-ip')?.trim()
  if (connecting !== undefined && connecting !== '') return connecting

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded === undefined || forwarded === '' ? 'unknown' : forwarded
}

export interface LoginFailures {
  /** True when this client has used up its attempts for the window. */
  locked: boolean
  /** Attempts recorded inside the window. */
  count: number
  /** Seconds until the window ends; `0` when there is no window. */
  retryAfterSeconds: number
}

const NO_FAILURES: LoginFailures = { locked: false, count: 0, retryAfterSeconds: 0 }

interface FailureRecord {
  count: number
  /** When the first failure in this window was recorded, in milliseconds. */
  firstAt: number
}

/** The stored record, or null when there is none or it is not one. */
async function readRecord(cache: KVNamespace, key: string): Promise<FailureRecord | null> {
  const raw = await cache.get(KEY_PREFIX + key)
  if (raw === null) return null

  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return null

    const { count, firstAt } = parsed as Record<string, unknown>
    if (typeof count !== 'number' || typeof firstAt !== 'number') return null

    return { count, firstAt }
  } catch {
    // A value that cannot be read is treated as no failures rather than as an
    // error: the worst it can do is hand back an attempt somebody already spent.
    return null
  }
}

/** What the window looks like right now, without changing it. */
export async function readLoginFailures(cache: KVNamespace, key: string): Promise<LoginFailures> {
  const record = await readRecord(cache, key)
  if (record === null) return NO_FAILURES

  const elapsed = Math.floor((Date.now() - record.firstAt) / 1000)
  const remaining = LOGIN_WINDOW_SECONDS - elapsed
  if (remaining <= 0) return NO_FAILURES

  return {
    locked: record.count >= MAX_LOGIN_FAILURES,
    count: record.count,
    retryAfterSeconds: remaining,
  }
}

/**
 * Records one wrong password and answers with the state it produced.
 *
 * Read-then-write, and KV is eventually consistent, so two attempts in flight at
 * once can both count as one. That is deliberate: the alternative is a strongly
 * consistent store on the login path, and being one attempt generous is not the
 * thing that decides whether an account is guessed.
 */
export async function recordLoginFailure(cache: KVNamespace, key: string): Promise<LoginFailures> {
  const existing = await readRecord(cache, key)
  const elapsed = existing === null ? 0 : Math.floor((Date.now() - existing.firstAt) / 1000)
  // A record past its window starts a new one at the current attempt.
  const fresh = existing === null || LOGIN_WINDOW_SECONDS - elapsed <= 0

  const record: FailureRecord = fresh
    ? { count: 1, firstAt: Date.now() }
    : { count: existing.count + 1, firstAt: existing.firstAt }

  const remaining = fresh
    ? LOGIN_WINDOW_SECONDS
    : Math.max(1, LOGIN_WINDOW_SECONDS - Math.floor((Date.now() - record.firstAt) / 1000))

  await cache.put(KEY_PREFIX + key, JSON.stringify(record), { expirationTtl: remaining })

  return {
    locked: record.count >= MAX_LOGIN_FAILURES,
    count: record.count,
    retryAfterSeconds: remaining,
  }
}

/** Forgets a client's failures, which is what a correct password does. */
export async function clearLoginFailures(cache: KVNamespace, key: string): Promise<void> {
  await cache.delete(KEY_PREFIX + key)
}
