import * as z from 'zod/mini'

/**
 * The white-label licence contract.
 *
 * The admin only ever reads this. Verification happens on the server, against a
 * public key and a secret the browser has no business holding -- so the shape here
 * is "what the operator is allowed to see about their own licence", not the
 * licence itself.
 *
 * `problem` is deliberately a string rather than a union of literals in the
 * schema. The server has a closed set of them; the client's job is to show one to
 * somebody, and a schema that listed them would have to be edited in lockstep
 * every time a new refusal reason is added, for no gain.
 */

export const licenseResponseSchema = z.object({
  /** True only for a licence that verified and names this domain. */
  whiteLabel: z.boolean(),
  /**
   * The hostname the licence was checked against.
   *
   * Sent so a `wrong_domain` is diagnosable from inside the admin: "it names
   * example.com" is only actionable next to "and this request arrived as
   * www.example.com".
   */
  domain: z.string(),
  /** Present when there is a valid licence. */
  license: z.optional(
    z.object({
      id: z.string(),
      domain: z.string(),
      issuedAt: z.string(),
      tier: z.string(),
    }),
  ),
  /** Present when a key was supplied but not honoured. */
  problem: z.optional(z.string()),
  /** The domain the licence names, when it named a different one. */
  licensedDomain: z.optional(z.string()),
})

export type LicenseResponse = z.infer<typeof licenseResponseSchema>
