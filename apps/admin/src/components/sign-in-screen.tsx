import type { BrandingResponse, LoginRequest } from '@typeky/api'
import { type FormEvent, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useApiClient } from '@/lib/client-context'
import { useT } from '@/lib/i18n'
import { describeApiError } from '@/lib/session'

/**
 * The sign-in screen.
 *
 * Every control is a real labelled control inside a real form, so pressing Enter
 * submits and a password manager can fill it. The failure message is a `role`
 * alert tied to the form by `aria-describedby`, rather than colour alone.
 *
 * It wears the site's logo rather than the platform's name. The site document is
 * behind the session this screen is asking for, so the name and logo arrive from
 * one public endpoint -- and a deployment that has neither is exactly the case the
 * software's own name is for.
 */
export function SignInScreen({ onSubmit }: { onSubmit: (credentials: LoginRequest) => Promise<void> }) {
  const t = useT()
  const client = useApiClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [brand, setBrand] = useState<BrandingResponse | null>(null)

  useEffect(() => {
    let cancelled = false

    client.readBranding().then(
      (branding) => {
        if (cancelled) return

        setBrand(branding)
        // The tab is part of the branding too, and until now it said the name of the
        // software rather than the name of the site.
        if (branding.name !== '') document.title = branding.name
      },
      () => {
        // Silent on purpose: the screen already says what it is without a logo, and
        // an error about decoration in front of the question being asked is noise.
      },
    )

    return () => {
      cancelled = true
    }
  }, [client])

  // The name is not printed on the screen -- the card says what it is and nothing
  // else -- but it is what the logo stands for, and what the tab is called.
  const name = brand !== null && brand.name !== '' ? brand.name : t('signIn.subtitle')

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError(null)

    try {
      await onSubmit({ username, password })
    } catch (thrown) {
      setError(describeApiError(thrown, t))
    } finally {
      setPending(false)
    }
  }

  return (
    <main id="main" className="flex min-h-dvh items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        {/*
          `justify-items-center` rather than `items-center`: the header is a grid, so
          `items` aligns along the block axis and a logo with an intrinsic width would
          sit at the start of its column. The title above the form is centred to match.
        */}
        <CardHeader className="justify-items-center text-center">
          {brand?.logoUrl != null && (
            <img
              src={brand.logoUrl}
              // The site's name, which is what the logo stands for. An empty alt
              // would leave a screen reader with nothing to announce.
              alt={name}
              className="mb-1 h-10 w-auto max-w-full object-contain"
              data-testid="sign-in-logo"
            />
          )}
          <CardTitle>{t('signIn.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={handleSubmit}
            className="space-y-4"
            aria-describedby={error === null ? undefined : 'sign-in-error'}
          >
            <div className="space-y-2">
              <Label htmlFor="username">{t('signIn.username')}</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoFocus
                required
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">{t('signIn.password')}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>

            {error !== null && (
              <p id="sign-in-error" role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? t('signIn.pending') : t('signIn.submit')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
