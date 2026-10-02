import type { LicenseResponse } from '@typeky/api'
import { useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useApiClient } from '@/lib/client-context'
import { useT, type Translate } from '@/lib/i18n'
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
  const t = useT()
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
        if (!cancelled) setError(describeApiError(thrown, t))
      },
    )

    return () => {
      cancelled = true
    }
  }, [client])

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('licence.title')}</CardTitle>
        <CardDescription>{t('licence.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {error !== '' && <p className="text-destructive">{error}</p>}

        {error === '' && license === null && <p className="text-muted-foreground">{t('licence.reading')}</p>}

        {license !== null && license.whiteLabel && license.license !== undefined && (
          <p>
            {t('licence.active', {
              domain: license.license.domain,
              issued: license.license.issuedAt.slice(0, 10),
              tier: license.license.tier,
            })}
          </p>
        )}

        {license !== null && !license.whiteLabel && license.problem === undefined && (
          <p className="text-muted-foreground">{t('licence.none')}</p>
        )}

        {license !== null && !license.whiteLabel && license.problem !== undefined && (
          <Alert variant="destructive">
            <AlertTitle>{t('licence.refused.title')}</AlertTitle>
            <AlertDescription>
              <p>
                {t('licence.refused.reason', {
                  reason: describeProblem(license.problem, t),
                  domain: license.domain,
                  licensed:
                    license.licensedDomain === undefined
                      ? '.'
                      : t('licence.refused.licensed', { domain: license.licensedDomain }),
                })}
              </p>
              <p className="mt-2">{t('licence.refused.reassurance')}</p>
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
function describeProblem(problem: string, t: Translate): string {
  const known = [
    'malformed',
    'bad_signature',
    'wrong_domain',
    'unknown_key',
  ] as const

  const match = known.find((candidate) => candidate === problem)

  return match === undefined ? problem : t(`licence.problem.${match}`)
}
