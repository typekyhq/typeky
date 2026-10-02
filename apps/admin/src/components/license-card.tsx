import type { LicenseResponse } from '@typeky/api'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'

/**
 * What the deployment is licensed to do.
 *
 * Read-only, and the place the slice's "a wrong domain is reported, not fatal"
 * actually lands: a Worker log is not something an operator on a shared host will
 * ever read, so a licence that does not apply has to say so somewhere they look.
 *
 * The three states are separate sentences on purpose. "No licence" is the ordinary
 * state of a free deployment and should read as information; "a licence that does
 * not apply here" is a mistake somebody can fix, and it has to name both domains
 * or it is a puzzle.
 */
export function LicenseCard() {
  const client = useApiClient()
  const [license, setLicense] = useState<LicenseResponse | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    client.getLicense().then(
      (result) => {
        if (!cancelled) setLicense(result)
      },
      (thrown: unknown) => {
        if (!cancelled) setError(describeApiError(thrown))
      },
    )

    return () => {
      cancelled = true
    }
  }, [client])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Licence</CardTitle>
        <CardDescription>
          A white-label licence removes the &ldquo;Powered by Typeky&rdquo; badge from the site and this panel.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error !== '' && <p className="text-destructive">{error}</p>}

        {error === '' && license === null && <p className="text-muted-foreground">Reading the licence…</p>}

        {license !== null && license.whiteLabel && license.license !== undefined && (
          <p>
            Active for <span className="font-medium">{license.license.domain}</span>, issued{' '}
            <time dateTime={license.license.issuedAt}>
              {license.license.issuedAt.slice(0, 10)}
            </time>{' '}
            ({license.license.tier}). Nothing here or on the site is attributed.
          </p>
        )}

        {license !== null && !license.whiteLabel && license.problem === undefined && (
          <p className="text-muted-foreground">
            None. The site&rsquo;s footer says &ldquo;Powered by Typeky&rdquo;, and so does the sidebar.
          </p>
        )}

        {license !== null && !license.whiteLabel && license.problem !== undefined && (
          <Alert variant="destructive">
            <AlertTitle>A licence key is set, and it does not apply here</AlertTitle>
            <AlertDescription>
              <p>
                It was refused because <span className="font-medium">{describeProblem(license.problem)}</span>. The
                request arrived as <span className="font-medium">{license.domain}</span>
                {license.licensedDomain === undefined ? (
                  '.'
                ) : (
                  <>
                    , and the licence names <span className="font-medium">{license.licensedDomain}</span>.
                  </>
                )}
              </p>
              <p className="mt-2">
                The site keeps serving, with the attribution on it. Nothing is blocked and nothing is lost.
              </p>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * The problem in a sentence.
 *
 * The server has a closed set of these, and the client knows what each one means
 * to a person. An unrecognised code falls back to the code itself rather than to
 * a guess: a new reason should read as an unfamiliar word, not as the wrong
 * explanation.
 */
function describeProblem(problem: string): string {
  switch (problem) {
    case 'malformed':
      return 'the key is not in the expected form, which usually means part of it was lost in a copy and paste'
    case 'bad_signature':
      return 'the signature does not match, so the key was edited, truncated, or not issued by us'
    case 'wrong_domain':
      return 'it was issued for a different domain'
    case 'unknown_key':
      return 'this build cannot check keys at all, which is a fault in the deployment rather than in the key'
    default:
      return problem
  }
}
