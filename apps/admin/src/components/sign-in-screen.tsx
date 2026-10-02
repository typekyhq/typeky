import type { LoginRequest } from '@typeky/api'
import { type FormEvent, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n'
import { describeApiError } from '@/lib/session'

/**
 * The sign-in screen.
 *
 * Every control is a real labelled control inside a real form, so pressing Enter
 * submits and a password manager can fill it. The failure message is a `role`
 * alert tied to the form by `aria-describedby`, rather than colour alone.
 */
export function SignInScreen({ onSubmit }: { onSubmit: (credentials: LoginRequest) => Promise<void> }) {
  const t = useT()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

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
        <CardHeader>
          <CardTitle>{t('signIn.title')}</CardTitle>
          <CardDescription>{t('signIn.subtitle')}</CardDescription>
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
