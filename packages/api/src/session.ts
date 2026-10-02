import * as z from 'zod/mini'

/**
 * The admin session contract.
 *
 * One definition serves three jobs, which is the point of having it here:
 * the Worker validates the login body with `loginRequestSchema`, validates the
 * record it reads back out of KV with `sessionSchema`, and the admin SPA derives
 * its types from both. Changing a field takes effect in all three at once.
 */

export const loginRequestSchema = z.object({
  username: z.string().check(z.minLength(1), z.maxLength(200)),
  password: z.string().check(z.minLength(1), z.maxLength(1000)),
})

export type LoginRequest = z.infer<typeof loginRequestSchema>

/**
 * The header the client echoes the session's CSRF token in.
 *
 * Lives in the contract because both sides have to agree on it, and two
 * hard-coded strings are two things to get wrong.
 */
export const CSRF_HEADER = 'x-csrf-token'

export const sessionSchema = z.object({
  actorId: z.string().check(z.minLength(1)),
  /**
   * Bound to this session; the client echoes it back in `x-csrf-token` on every
   * write (architecture section 8).
   */
  csrfToken: z.string().check(z.minLength(1)),
  /** ISO 8601 UTC. */
  createdAt: z.string().check(z.minLength(1)),
})

export type Session = z.infer<typeof sessionSchema>
