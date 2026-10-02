import {
  siteWriteSchema,
  type NavItem,
  type SiteResponse,
  type SiteWrite,
  type SocialLink,
} from '@typeky/api'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'

/**
 * Site settings.
 *
 * The form validates with the same schema the Worker does, so the messages land
 * on the field that caused them rather than arriving as one opaque 400. A field
 * the form does not edit -- `logoMediaId`, until the media library exists -- is
 * carried through unchanged, because the write is a whole document.
 *
 * Navigation order is edited with buttons rather than drag and drop: it works
 * from the keyboard, and the drag library arrives with the block editor.
 */

type Status = 'loading' | 'ready' | 'error'

const DEFAULT_ACCENT = '#111827'

export function SettingsPage() {
  const client = useApiClient()
  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<SiteWrite | null>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    client.getSite().then(
      (site) => {
        if (cancelled) return
        setDraft(toDraft(site))
        setIssues({})
        setStatus('ready')
      },
      (thrown: unknown) => {
        if (cancelled) return
        setLoadError(describeApiError(thrown))
        setStatus('error')
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, attempt])

  const update = useCallback((change: (current: SiteWrite) => SiteWrite) => {
    setDraft((current) => (current === null ? current : change(current)))
  }, [])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (draft === null) return

    const parsed = siteWriteSchema.safeParse(draft)
    if (!parsed.success) {
      setIssues(collectIssues(parsed.error.issues))
      toast.error('Some fields need attention.')
      return
    }

    setIssues({})
    setSaving(true)

    try {
      const saved = await client.saveSite(parsed.data)
      setDraft(toDraft(saved))
      toast.success(`Saved at ${new Date(saved.updatedAt).toLocaleTimeString()}`)
    } catch (thrown) {
      toast.error(describeApiError(thrown))
    } finally {
      setSaving(false)
    }
  }

  if (status === 'loading') return <LoadingState label="Loading site settings" />

  if (status === 'error' || draft === null) {
    return (
      <ErrorState
        title="Cannot load the site settings"
        description={loadError}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    )
  }

  const settings = draft.settings
  const nav = [...draft.nav].sort((left, right) => left.order - right.order)
  const socialLinks = settings.socialLinks ?? []

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">How the site introduces itself, everywhere.</p>
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Identity</CardTitle>
          <CardDescription>Shown in the page header, the browser tab and search results.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="name"
            label="Name"
            value={draft.name}
            error={issues.name}
            onChange={(value) => update((current) => ({ ...current, name: value }))}
          />
          <Field
            id="tagline"
            label="Tagline"
            value={draft.tagline ?? ''}
            error={issues.tagline}
            onChange={(value) => update((current) => ({ ...current, tagline: value }))}
          />
          <Field
            id="theme"
            label="Theme"
            value={draft.theme}
            error={issues.theme}
            hint="Only the bundled default theme ships today."
            onChange={(value) => update((current) => ({ ...current, theme: value }))}
          />
          <div className="space-y-2">
            <Label htmlFor="accentColor">Accent colour</Label>
            <Input
              id="accentColor"
              type="color"
              className="h-9 w-20 p-1"
              value={settings.accentColor ?? DEFAULT_ACCENT}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, accentColor: event.target.value },
                }))
              }
            />
            {issues['settings.accentColor'] !== undefined && (
              <p className="text-sm text-destructive">{issues['settings.accentColor']}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Navigation</CardTitle>
          <CardDescription>The menu visitors see. Order here is the order on the site.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {nav.length === 0 && <p className="text-sm text-muted-foreground">No navigation items yet.</p>}

          <ol className="space-y-3">
            {nav.map((item, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <Field
                    id={`nav-${index}-label`}
                    label={`Item ${index + 1} label`}
                    value={item.label}
                    error={issues[`nav.${index}.label`]}
                    onChange={(value) => update((current) => ({ ...current, nav: replaceNav(current.nav, index, { label: value }) }))}
                  />
                </div>
                <div className="min-w-40 flex-1">
                  <Field
                    id={`nav-${index}-href`}
                    label={`Item ${index + 1} link`}
                    value={item.href}
                    error={issues[`nav.${index}.href`]}
                    onChange={(value) => update((current) => ({ ...current, nav: replaceNav(current.nav, index, { href: value }) }))}
                  />
                </div>
                <div className="flex gap-1 pb-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={index === 0}
                    aria-label={`Move ${item.label || 'item'} up`}
                    onClick={() => update((current) => ({ ...current, nav: moveNav(current.nav, index, -1) }))}
                  >
                    ↑
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={index === nav.length - 1}
                    aria-label={`Move ${item.label || 'item'} down`}
                    onClick={() => update((current) => ({ ...current, nav: moveNav(current.nav, index, 1) }))}
                  >
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-label={`Remove ${item.label || 'item'}`}
                    onClick={() =>
                      update((current) => ({
                        ...current,
                        nav: current.nav.filter((entry) => entry !== item).map((entry, position) => ({ ...entry, order: position })),
                      }))
                    }
                  >
                    ✕
                  </Button>
                </div>
              </li>
            ))}
          </ol>

          {issues.nav !== undefined && <p className="text-sm text-destructive">{issues.nav}</p>}

          <Button
            type="button"
            variant="outline"
            onClick={() =>
              update((current) => ({
                ...current,
                nav: [...current.nav, { label: '', href: '/', order: current.nav.length }],
              }))
            }
          >
            Add item
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Social links</CardTitle>
          <CardDescription>Rendered by the theme's footer and header snippets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {socialLinks.length === 0 && <p className="text-sm text-muted-foreground">No social links yet.</p>}

          <ol className="space-y-3">
            {socialLinks.map((link, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <Field
                    id={`social-${index}-label`}
                    label={`Link ${index + 1} label`}
                    value={link.label}
                    error={issues[`settings.socialLinks.${index}.label`]}
                    onChange={(value) =>
                      update((current) => ({
                        ...current,
                        settings: { ...current.settings, socialLinks: replaceSocial(socialLinks, index, { label: value }) },
                      }))
                    }
                  />
                </div>
                <div className="min-w-40 flex-1">
                  <Field
                    id={`social-${index}-href`}
                    label={`Link ${index + 1} URL`}
                    value={link.href}
                    error={issues[`settings.socialLinks.${index}.href`]}
                    onChange={(value) =>
                      update((current) => ({
                        ...current,
                        settings: { ...current.settings, socialLinks: replaceSocial(socialLinks, index, { href: value }) },
                      }))
                    }
                  />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mb-0.5"
                  aria-label={`Remove ${link.label || 'link'}`}
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        socialLinks: socialLinks.filter((entry) => entry !== link),
                      },
                    }))
                  }
                >
                  ✕
                </Button>
              </li>
            ))}
          </ol>

          {issues['settings.socialLinks'] !== undefined && (
            <p className="text-sm text-destructive">{issues['settings.socialLinks']}</p>
          )}

          <Button
            type="button"
            variant="outline"
            onClick={() =>
              update((current) => ({
                ...current,
                settings: { ...current.settings, socialLinks: [...socialLinks, { label: '', href: 'https://' }] },
              }))
            }
          >
            Add link
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>SEO defaults</CardTitle>
          <CardDescription>Used when a page does not set its own.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            id="seo-title"
            label="Default title"
            value={settings.seo?.defaultTitle ?? ''}
            error={issues['settings.seo.defaultTitle']}
            onChange={(value) =>
              update((current) => ({
                ...current,
                settings: { ...current.settings, seo: { ...current.settings.seo, defaultTitle: value } },
              }))
            }
          />
          <div className="space-y-2">
            <Label htmlFor="seo-description">Default description</Label>
            <Textarea
              id="seo-description"
              value={settings.seo?.defaultDescription ?? ''}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, seo: { ...current.settings.seo, defaultDescription: event.target.value } },
                }))
              }
            />
            {issues['settings.seo.defaultDescription'] !== undefined && (
              <p className="text-sm text-destructive">{issues['settings.seo.defaultDescription']}</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Footer</CardTitle>
          <CardDescription>The last line of every page.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="footer">Footer text</Label>
            <Textarea
              id="footer"
              value={settings.footer ?? ''}
              onChange={(event) =>
                update((current) => ({
                  ...current,
                  settings: { ...current.settings, footer: event.target.value },
                }))
              }
            />
            {issues['settings.footer'] !== undefined && (
              <p className="text-sm text-destructive">{issues['settings.footer']}</p>
            )}
          </div>
          <Field
            id="filingNumber"
            label="Filing number"
            value={settings.filingNumber ?? ''}
            error={issues['settings.filingNumber']}
            hint="Only needed for deployments in mainland China."
            onChange={(value) =>
              update((current) => ({
                ...current,
                settings: { ...current.settings, filingNumber: value },
              }))
            }
          />
        </CardContent>
      </Card>

      <p className="text-sm text-muted-foreground">
        The logo is set from the media library, which arrives with the content work.
      </p>
    </form>
  )
}

function Field({
  id,
  label,
  value,
  onChange,
  error,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  hint?: string
}) {
  const describedBy = error !== undefined ? `${id}-error` : undefined

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error !== undefined}
        aria-describedby={describedBy}
      />
      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hint !== undefined && error === undefined && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

function toDraft(site: SiteResponse): SiteWrite {
  return {
    name: site.name,
    tagline: site.tagline,
    // Carried through untouched: the form has no way to edit it yet, and the
    // write replaces the whole document.
    logoMediaId: site.logoMediaId,
    theme: site.theme,
    settings: {
      ...site.settings,
      accentColor: site.settings.accentColor ?? DEFAULT_ACCENT,
      socialLinks: site.settings.socialLinks ?? [],
    },
    nav: [...site.nav].sort((left, right) => left.order - right.order),
  }
}

function collectIssues(
  issues: ReadonlyArray<{ path: ReadonlyArray<unknown>; message: string }>,
): Record<string, string> {
  const collected: Record<string, string> = {}

  for (const issue of issues) {
    const key = issue.path.map((segment) => String(segment)).join('.')
    if (key !== '' && collected[key] === undefined) collected[key] = issue.message
  }

  return collected
}

function replaceNav(items: NavItem[], index: number, change: Partial<NavItem>): NavItem[] {
  return items.map((item, position) => (position === index ? { ...item, ...change } : item))
}

function replaceSocial(items: SocialLink[], index: number, change: Partial<SocialLink>): SocialLink[] {
  return items.map((item, position) => (position === index ? { ...item, ...change } : item))
}

/** Swaps two entries and renumbers them, so order always matches the list. */
function moveNav(items: NavItem[], index: number, delta: number): NavItem[] {
  const target = index + delta
  if (target < 0 || target >= items.length) return items

  const next = [...items]
  const moved = next[target]
  next[target] = next[index]
  next[index] = moved

  return next.map((item, position) => ({ ...item, order: position }))
}
