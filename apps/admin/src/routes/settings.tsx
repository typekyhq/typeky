import {
  siteWriteSchema,
  type NavItem,
  type SiteResponse,
  type SiteWrite,
  type SocialLink,
} from '@typeky/api'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { LicensePanel } from '@/components/license-panel'
import { MediaField } from '@/components/media-picker'
import { ErrorState, LoadingState } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import {
  DEFAULT_ADMIN_DATE_FORMAT,
  DEFAULT_DATE_FORMAT,
  DEFAULT_LANGUAGE,
  formatDate,
} from '@typeky/core'
import { ApiError } from '@/lib/api-client'
import { useApiClient } from '@/lib/client-context'
import { ADMIN_LOCALES, LANGUAGE_TAGS } from '@/lib/locales'
import { formatLocal, usePanelPreference } from '@/lib/panel-preference'
import { describeApiError } from '@/lib/session'
import { useT } from '@/lib/i18n'
import { tabOwning, type FormTab } from '@/lib/tabs'

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

const TABS: FormTab[] = [
  {
    id: 'identity',
    labelKey: 'settings.identity',
    owns: ['name', 'tagline', 'theme', 'logoMediaId', 'settings.accentColor'],
  },
  { id: 'navigation', labelKey: 'settings.nav', owns: ['nav'] },
  { id: 'social', labelKey: 'settings.social', owns: ['settings.socialLinks'] },
  { id: 'seo', labelKey: 'settings.seo', owns: ['settings.seo'] },
  { id: 'footer', labelKey: 'settings.footer', owns: ['settings.footer'] },
  {
    id: 'language',
    labelKey: 'settings.language.dates',
    owns: ['settings.language', 'settings.dateFormat', 'settings.admin'],
  },
  { id: 'licence', labelKey: 'licence.title', owns: [] },
]

const FIRST_TAB = 'identity'

/**
 * The instant the format previews are rendered at.
 *
 * Fixed rather than `new Date()` so the two previews sit still while somebody
 * types, and so the site's preview can say plainly which moment it is showing --
 * a format's output cannot be checked against a date that keeps moving.
 */
const PREVIEW_INSTANT = '2026-01-05T09:07:03.000Z'
const PREVIEW_INSTANT_UTC_LABEL = '2026-01-05 09:07 UTC'

const DEFAULT_ACCENT = '#111827'

export function SettingsPage() {
  const t = useT()
  const client = useApiClient()
  const panel = usePanelPreference()
  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState('')
  const [draft, setDraft] = useState<SiteWrite | null>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  /**
   * True while this deployment has no site row yet.
   *
   * A fresh deploy has none, and the write is an upsert, so the way to create one
   * is to fill this form in. Reporting "not found" on the read -- which is the
   * truthful thing the server said -- would leave the operator with no way
   * forward at all and a site that answers 503 forever.
   */
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState(FIRST_TAB)

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

        // A fresh deployment has no site row yet, and the write is an upsert, so
        // the way to create one is to fill this form in. Showing the server's
        // "not found" -- truthful as it is -- would leave the operator with no way
        // forward and a site that answers 503 forever.
        if (thrown instanceof ApiError && thrown.code === 'not_found') {
          setDraft(blankDocument())
          setCreating(true)
          setStatus('ready')
          return
        }

        setLoadError(describeApiError(thrown, t))
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
      const collected = collectIssues(parsed.error.issues)
      setIssues(collected)

      // Take the operator to the panel the first problem is in. Without this the
      // message is "some fields need attention" and the field is behind a tab
      // they have no reason to open.
      const first = Object.keys(collected)[0]
      if (first !== undefined) setTab(tabOwning(TABS, first))

      toast.error(t('editor.fieldsNeedAttention'))
      return
    }

    setIssues({})
    setSaving(true)

    try {
      const saved = await client.saveSite(parsed.data)
      setDraft(toDraft(saved))
      // The row exists now, so this is an ordinary settings screen from here on.
      setCreating(false)
      // The shell caches this preference; without this the list and the editors
      // would keep writing dates the old way until a reload.
      panel.refresh()
      toast.success(`Saved at ${panel.format(saved.updatedAt)}`)
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setSaving(false)
    }
  }

  if (status === 'loading') return <LoadingState label={t('settings.loading')} />

  if (status === 'error' || draft === null) {
    return (
      <ErrorState
        title={t('settings.loadFailed')}
        description={loadError}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    )
  }

  const settings = draft.settings
  const nav = [...draft.nav].sort((left, right) => left.order - right.order)
  const socialLinks = settings.socialLinks ?? []

  // The site's preview is rendered in UTC, which is what the bundled theme asks
  // for and what a Worker runs in; the panel's is in the operator's own zone.
  const sitePreview = formatDate(PREVIEW_INSTANT, settings.dateFormat ?? DEFAULT_DATE_FORMAT, {
    timeZone: 'UTC',
  })
  const adminPreview = formatLocal(PREVIEW_INSTANT, settings.admin?.dateFormat ?? DEFAULT_ADMIN_DATE_FORMAT)

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{t('settings.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('settings.description')}</p>
        </div>
        <Button type="submit" disabled={saving}>
          {saving ? t('editor.saving') : t('settings.save')}
        </Button>
      </div>

      {creating && (
        <Alert>
          <AlertTitle>{t('settings.creating.title')}</AlertTitle>
          <AlertDescription>{t('settings.creating.description')}</AlertDescription>
        </Alert>
      )}

      {/*
        `forceMount` keeps every panel in the document: this screen is one form
        with one Save button, and a panel that unmounted would take its fields out
        of the form the moment somebody looked at another one. Radix leaves the
        hiding of the panels it keeps mounted to the caller -- its own `hidden` is
        always false when the content is forced -- so each one says whether it is
        the visible one.
      */}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label={t('settings.sections')}>
          {TABS.map((entry) => (
            <TabsTrigger key={entry.id} value={entry.id}>
              {t(entry.labelKey)}
            </TabsTrigger>
          ))}
        </TabsList>

      <TabsContent value="identity" forceMount hidden={tab !== 'identity'}>
        <Card>
          <CardHeader>
            <CardDescription>{t('settings.identity.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field
              id="name"
              label={t('settings.name')}
              value={draft.name}
              error={issues.name}
              onChange={(value) => update((current) => ({ ...current, name: value }))}
            />
            <Field
              id="tagline"
              label={t('settings.tagline')}
              value={draft.tagline ?? ''}
              error={issues.tagline}
              onChange={(value) => update((current) => ({ ...current, tagline: value }))}
            />
            <Field
              id="theme"
              label={t('settings.theme')}
              value={draft.theme}
              error={issues.theme}
              hint={t('settings.theme.hint')}
              onChange={(value) => update((current) => ({ ...current, theme: value }))}
            />
            <div className="space-y-2">
              <Label htmlFor="accentColor">{t('settings.accentColour')}</Label>
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
            <div className="sm:col-span-2">
              <MediaField
                id="logoMediaId"
                label={t('settings.logo')}
                value={draft.logoMediaId ?? ''}
                error={issues.logoMediaId}
                hint={t('settings.logo.hint')}
                onChange={(value) =>
                  update((current) => ({ ...current, logoMediaId: value === '' ? null : value }))
                }
              />
            </div>
          </CardContent>
        </Card>
      </TabsContent>


      <TabsContent value="navigation" forceMount hidden={tab !== 'navigation'}>
        <Card>
          <CardHeader>
            <CardDescription>{t('settings.nav.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {nav.length === 0 && <p className="text-sm text-muted-foreground">{t('settings.nav.empty')}</p>}

            <ol className="space-y-3">
              {nav.map((item, index) => (
                <li key={index} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-40 flex-1">
                    <Field
                      id={`nav-${index}-label`}
                      label={t('settings.nav.itemLabel', { number: index + 1 })}
                      value={item.label}
                      error={issues[`nav.${index}.label`]}
                      onChange={(value) => update((current) => ({ ...current, nav: replaceNav(current.nav, index, { label: value }) }))}
                    />
                  </div>
                  <div className="min-w-40 flex-1">
                    <Field
                      id={`nav-${index}-href`}
                      label={t('settings.nav.itemHref', { number: index + 1 })}
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
                      aria-label={t('settings.nav.moveUp', { label: item.label || t('settings.nav.unnamed') })}
                      onClick={() => update((current) => ({ ...current, nav: moveNav(current.nav, index, -1) }))}
                    >
                      ↑
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={index === nav.length - 1}
                      aria-label={t('settings.nav.moveDown', { label: item.label || t('settings.nav.unnamed') })}
                      onClick={() => update((current) => ({ ...current, nav: moveNav(current.nav, index, 1) }))}
                    >
                      ↓
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t('settings.nav.remove', { label: item.label || t('settings.nav.unnamed') })}
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
              {t('settings.nav.add')}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>


      <TabsContent value="social" forceMount hidden={tab !== 'social'}>
        <Card>
          <CardHeader>
            <CardDescription>{t('settings.social.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {socialLinks.length === 0 && <p className="text-sm text-muted-foreground">{t('settings.social.empty')}</p>}

            <ol className="space-y-3">
              {socialLinks.map((link, index) => (
                <li key={index} className="flex flex-wrap items-end gap-2">
                  <div className="min-w-40 flex-1">
                    <Field
                      id={`social-${index}-label`}
                      label={t('settings.social.linkLabel', { number: index + 1 })}
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
                      label={t('settings.social.linkHref', { number: index + 1 })}
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
                    aria-label={t('settings.social.remove', { label: link.label || t('settings.social.unnamed') })}
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
              {t('settings.social.add')}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>


      <TabsContent value="seo" forceMount hidden={tab !== 'seo'}>
        <Card>
          <CardHeader>
            <CardDescription>{t('settings.seo.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field
              id="seo-title"
              label={t('settings.seo.title')}
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
              <Label htmlFor="seo-description">{t('settings.seo.description')}</Label>
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
      </TabsContent>


      <TabsContent value="footer" forceMount hidden={tab !== 'footer'}>
        <Card>
          <CardHeader>
            <CardDescription>{t('settings.footer.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="footer">{t('settings.footer.text')}</Label>
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
          </CardContent>
        </Card>
      </TabsContent>


      <TabsContent value="language" forceMount hidden={tab !== 'language'}>
        <Card>
          <CardHeader>
            <CardDescription>{t('settings.language.dates.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="language">{t('settings.language')}</Label>
              <Input
                id="language"
                list="language-tags"
                value={settings.language ?? ''}
                placeholder={DEFAULT_LANGUAGE}
                aria-invalid={issues['settings.language'] !== undefined}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    settings: { ...current.settings, language: event.target.value },
                  }))
                }
              />
              <datalist id="language-tags">
                {LANGUAGE_TAGS.map((tag) => (
                  <option key={tag} value={tag} />
                ))}
              </datalist>
              {issues['settings.language'] !== undefined && (
                <p className="text-sm text-destructive">{issues['settings.language']}</p>
              )}
              <p className="text-sm text-muted-foreground">{t('settings.language.hint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dateFormat">{t('settings.dateFormat')}</Label>
              <Input
                id="dateFormat"
                value={settings.dateFormat ?? ''}
                placeholder={DEFAULT_DATE_FORMAT}
                aria-invalid={issues['settings.dateFormat'] !== undefined}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    settings: { ...current.settings, dateFormat: event.target.value },
                  }))
                }
              />
              {issues['settings.dateFormat'] !== undefined && (
                <p className="text-sm text-destructive">{issues['settings.dateFormat']}</p>
              )}
              <p className="text-sm text-muted-foreground">
                {t('settings.dateFormat.preview', { instant: PREVIEW_INSTANT_UTC_LABEL, formatted: sitePreview })}
              </p>
              <p className="text-sm text-muted-foreground">{t('settings.dateFormat.directives')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adminLanguage">{t('settings.adminLanguage')}</Label>
              <Select
                id="adminLanguage"
                value={settings.admin?.language ?? DEFAULT_LANGUAGE}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    settings: { ...current.settings, admin: { ...current.settings.admin, language: event.target.value } },
                  }))
                }
              >
                {ADMIN_LOCALES.map((locale) => (
                  <option key={locale.value} value={locale.value}>
                    {locale.label}
                  </option>
                ))}
              </Select>
              <p className="text-sm text-muted-foreground">
                {t('settings.adminLanguage.hint')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adminDateFormat">{t('settings.adminDateFormat')}</Label>
              <Input
                id="adminDateFormat"
                value={settings.admin?.dateFormat ?? ''}
                placeholder={DEFAULT_ADMIN_DATE_FORMAT}
                aria-invalid={issues['settings.admin.dateFormat'] !== undefined}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    settings: {
                      ...current.settings,
                      admin: { ...current.settings.admin, dateFormat: event.target.value },
                    },
                  }))
                }
              />
              {issues['settings.admin.dateFormat'] !== undefined && (
                <p className="text-sm text-destructive">{issues['settings.admin.dateFormat']}</p>
              )}
              <p className="text-sm text-muted-foreground">
                {t('settings.adminDateFormat.preview', { formatted: adminPreview })}
              </p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>


      <TabsContent value="licence" forceMount hidden={tab !== 'licence'}>
        <Card>
          <CardHeader>
            <CardDescription>{t('licence.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <LicensePanel />
          </CardContent>
        </Card>
      </TabsContent>
      </Tabs>
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

/**
 * The document a deployment starts from.
 *
 * Everything optional is left out and everything required is empty, so the form
 * opens on blank fields and the schema is the thing that says a name is needed --
 * the same schema the Worker will apply.
 */
function blankDocument(): SiteWrite {
  return { name: '', tagline: null, logoMediaId: null, theme: 'default', settings: {}, nav: [] }
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
