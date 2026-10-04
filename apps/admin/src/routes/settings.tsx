import {
  siteWriteSchema,
  type NavItem,
  type SiteResponse,
  type SiteWrite,
  type SocialLink,
} from '@typeky/api'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Field } from '@/components/field'
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
  DEFAULT_TIME_ZONE,
  formatDate,
  isTimeZone,
} from '@typeky/core'
import { ApiError } from '@/lib/api-client'
import { useApiClient } from '@/lib/client-context'
import { ADMIN_DATE_FORMATS, SITE_DATE_FORMATS, withCurrentFormat } from '@/lib/date-formats'
import { ADMIN_LOCALES, LANGUAGE_TAGS, TIME_ZONES } from '@/lib/locales'
import { formatLocal, usePanelPreference } from '@/lib/panel-preference'
import { describeApiError } from '@/lib/session'
import { DEFAULT_ADMIN_PATH, PLATFORM_PATHS, type ThemeSummary } from '@typeky/api'
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

/** The nested settings the form edits as a group. */
type SeoSettings = NonNullable<SiteWrite['settings']['seo']>
type RobotsSettings = NonNullable<SeoSettings['robots']>
type AdminSettings = NonNullable<SiteWrite['settings']['admin']>

const TABS: FormTab[] = [
  {
    id: 'identity',
    labelKey: 'settings.identity',
    owns: [
    'name',
    'tagline',
    'theme',
    'logoMediaId',
    'faviconMediaId',
    'settings.accentColor',
    // The footer copy lives here rather than in a panel of its own: it is one line
    // of the site's identity, and a tab with one field in it is a tab nobody opens.
    'settings.footer',
  ],
  },
  {
    id: 'paths',
    labelKey: 'settings.paths',
    owns: ['settings.reservedPaths', 'settings.admin.path'],
  },
  { id: 'navigation', labelKey: 'settings.nav', owns: ['nav'] },
  { id: 'social', labelKey: 'settings.social', owns: ['settings.socialLinks'] },
  { id: 'seo', labelKey: 'settings.seo', owns: ['settings.seo'] },
  { id: 'custom', labelKey: 'settings.custom', owns: ['settings.custom'] },
  {
    id: 'language',
    labelKey: 'settings.language.dates',
    owns: ['settings.language', 'settings.dateFormat', 'settings.timezone', 'settings.admin'],
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
  /**
   * The themes this deployment can serve.
   *
   * Read for the field rather than typed into it: a name that is not installed
   * renders the bundled theme while telling the operator they chose something else.
   */
  const [installedThemes, setInstalledThemes] = useState<ThemeSummary[]>([])

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

  useEffect(() => {
    let cancelled = false

    client.listThemes().then(
      (result) => {
        if (!cancelled) setInstalledThemes(result.themes)
      },
      () => {
        // Silent: the page still works, and a failure here is reported by the save if
        // it turns out to matter.
      },
    )

    return () => {
      cancelled = true
    }
  }, [client])

  const update = useCallback((change: (current: SiteWrite) => SiteWrite) => {
    setDraft((current) => (current === null ? current : change(current)))
  }, [])

  /**
   * One field of a nested settings object, without the spread the caller would
   * otherwise have to repeat. The write is a whole document, so each of these puts
   * back the three levels it touched and nothing else.
   */
  const setSeo = useCallback(
    (change: (seo: SeoSettings) => SeoSettings) => {
      update((current) => ({
        ...current,
        settings: { ...current.settings, seo: change(current.settings.seo ?? {}) },
      }))
    },
    [update],
  )

  const setRobots = useCallback(
    (change: (robots: RobotsSettings) => RobotsSettings) => {
      setSeo((seo) => ({ ...seo, robots: change(seo.robots ?? {}) }))
    },
    [setSeo],
  )

  const setAdmin = useCallback(
    (change: (admin: AdminSettings) => AdminSettings) => {
      update((current) => ({
        ...current,
        settings: { ...current.settings, admin: change(current.settings.admin ?? {}) },
      }))
    },
    [update],
  )

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
      if (saved.settings.admin?.path !== draft.settings.admin?.path) {
        // The one save whose result the operator has to be told out loud, because
        // everything they have bookmarked has just moved.
        toast.success(
          t('settings.adminPath.moved', {
            path: `/${saved.settings.admin?.path ?? DEFAULT_ADMIN_PATH}`,
          }),
        )
      } else {
        toast.success(`Saved at ${panel.format(saved.updatedAt)}`)
      }
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
  const custom = settings.custom ?? []

  // Where the panel answers: the draft value when there is one, the default when
  // there is not, so the chip below shows something true either way.
  const adminPath =
    settings.admin?.path !== undefined && settings.admin.path !== ''
      ? settings.admin.path
      : DEFAULT_ADMIN_PATH

  // The typed value can be half a zone -- `Asia/Shang` on the way to somewhere --
  // and `Intl` throws on a zone it does not know. The preview falls back to UTC
  // while that is true instead of taking the page down with it; the field still
  // shows what was typed, and saving refuses it.
  const typedTimeZone = settings.timezone ?? ''
  const siteTimeZone = isTimeZone(typedTimeZone) ? typedTimeZone : DEFAULT_TIME_ZONE
  const sitePreview = formatDate(PREVIEW_INSTANT, settings.dateFormat ?? DEFAULT_DATE_FORMAT, {
    timeZone: siteTimeZone,
  })
  const adminPreview = formatLocal(PREVIEW_INSTANT, settings.admin?.dateFormat ?? DEFAULT_ADMIN_DATE_FORMAT)

  // The instant, said in the zone being previewed, so the two lines agree about
  // which moment they are describing.
  const instantLabel = `${formatDate(PREVIEW_INSTANT, '%Y-%m-%d %H:%M', { timeZone: siteTimeZone })} ${siteTimeZone}`

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
            <div className="space-y-2">
              <Label htmlFor="theme">{t('settings.theme')}</Label>
              <Select
                id="theme"
                value={draft.theme}
                aria-invalid={issues.theme !== undefined}
                onChange={(event) => update((current) => ({ ...current, theme: event.target.value }))}
              >
                {installedThemes.map((theme) => (
                  <option key={theme.name} value={theme.name}>
                    {theme.bundled ? `${theme.name} · ${t('settings.theme.bundled')}` : theme.name}
                  </option>
                ))}
                {/*
                  A theme the site is set to that is no longer installed stays an
                  option: leaving it out would render the first theme as the value,
                  and the next save would move the site without anybody asking.
                */}
                {!installedThemes.some((theme) => theme.name === draft.theme) && (
                  <option value={draft.theme}>{draft.theme}</option>
                )}
              </Select>
              {issues.theme !== undefined && <p className="text-sm text-destructive">{issues.theme}</p>}
              <p className="text-xs text-muted-foreground">{t('settings.theme.hint')}</p>
            </div>
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
            <div className="sm:col-span-2">
              <MediaField
                id="faviconMediaId"
                label={t('settings.favicon')}
                value={draft.faviconMediaId ?? ''}
                error={issues.faviconMediaId}
                hint={t('settings.favicon.hint')}
                onChange={(value) =>
                  update((current) => ({ ...current, faviconMediaId: value === '' ? null : value }))
                }
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
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
              <p className="text-sm text-muted-foreground">{t('settings.footer.hint')}</p>
              {issues['settings.footer'] !== undefined && (
                <p className="text-sm text-destructive">{issues['settings.footer']}</p>
              )}
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
              onChange={(value) => setSeo((seo) => ({ ...seo, defaultTitle: value }))}
            />
            <div className="space-y-2">
              <Label htmlFor="seo-description">{t('settings.seo.description')}</Label>
              <Textarea
                id="seo-description"
                value={settings.seo?.defaultDescription ?? ''}
                onChange={(event) => setSeo((seo) => ({ ...seo, defaultDescription: event.target.value }))}
              />
              {issues['settings.seo.defaultDescription'] !== undefined && (
                <p className="text-sm text-destructive">{issues['settings.seo.defaultDescription']}</p>
              )}
            </div>
            <Field
              id="seo-title-template"
              label={t('settings.seo.titleTemplate')}
              value={settings.seo?.titleTemplate ?? ''}
              error={issues['settings.seo.titleTemplate']}
              hint={t('settings.seo.titleTemplate.hint')}
              onChange={(value) => setSeo((seo) => ({ ...seo, titleTemplate: value }))}
            />
            <MediaField
              id="seo-og-image"
              label={t('settings.seo.ogImage')}
              value={settings.seo?.defaultOgImageMediaId ?? ''}
              error={issues['settings.seo.defaultOgImageMediaId']}
              hint={t('settings.seo.ogImage.hint')}
              onChange={(value) =>
                setSeo((seo) => ({ ...seo, defaultOgImageMediaId: value === '' ? null : value }))
              }
            />

            {/*
              Robots last, and set apart: everything above is a default a page may
              override, while this is a statement about the whole site.
            */}
            <fieldset className="space-y-3 border-t pt-4">
              <legend className="text-sm font-medium">{t('settings.seo.robots')}</legend>
              <p className="text-sm text-muted-foreground">{t('settings.seo.robots.hint')}</p>
              <Label className="font-normal">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={settings.seo?.robots?.noindex ?? false}
                  onChange={(event) =>
                    setRobots((robots) => ({ ...robots, noindex: event.target.checked }))
                  }
                />
                {t('settings.seo.noindex')}
              </Label>
              <div className="space-y-2">
                <Label htmlFor="seo-disallow">{t('settings.seo.disallow')}</Label>
                <Textarea
                  id="seo-disallow"
                  rows={3}
                  value={(settings.seo?.robots?.disallowPaths ?? []).join('\n')}
                  onChange={(event) =>
                    setRobots((robots) => ({ ...robots, disallowPaths: splitPaths(event.target.value) }))
                  }
                />
                {issues['settings.seo.robots.disallowPaths'] !== undefined && (
                  <p className="text-sm text-destructive">
                    {issues['settings.seo.robots.disallowPaths']}
                  </p>
                )}
                <p className="max-w-prose text-xs text-muted-foreground">
                  {t('settings.seo.disallow.hint')}
                </p>
              </div>
            </fieldset>
          </CardContent>
        </Card>
      </TabsContent>


      <TabsContent value="custom" forceMount hidden={tab !== 'custom'}>
        <Card>
          <CardHeader>
            <CardDescription>{t('settings.custom.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {custom.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('settings.custom.empty')}</p>
            )}

            <ol className="space-y-3">
              {custom.map((entry, index) => (
                <li key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-start">
                  <Field
                    id={`custom-${String(index)}-key`}
                    label={t('settings.custom.key', { number: index + 1 })}
                    value={entry.key}
                    error={issues[`settings.custom.${String(index)}.key`]}
                    onChange={(value) =>
                      update((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          custom: replaceCustom(current.settings.custom ?? [], index, { key: value }),
                        },
                      }))
                    }
                  />
                  <Field
                    id={`custom-${String(index)}-value`}
                    label={t('settings.custom.value', { number: index + 1 })}
                    value={entry.value}
                    error={issues[`settings.custom.${String(index)}.value`]}
                    onChange={(value) =>
                      update((current) => ({
                        ...current,
                        settings: {
                          ...current.settings,
                          custom: replaceCustom(current.settings.custom ?? [], index, { value }),
                        },
                      }))
                    }
                  />
                  <div className="flex gap-1 pb-0.5 sm:mt-6">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      aria-label={t('settings.custom.remove', {
                        key: entry.key || t('settings.custom.unnamed'),
                      })}
                      onClick={() =>
                        update((current) => ({
                          ...current,
                          settings: {
                            ...current.settings,
                            custom: (current.settings.custom ?? []).filter((_, position) => position !== index),
                          },
                        }))
                      }
                    >
                      ✕
                    </Button>
                  </div>
                </li>
              ))}
            </ol>

            {issues['settings.custom'] !== undefined && (
              <p className="text-sm text-destructive">{issues['settings.custom']}</p>
            )}

            <Button
              type="button"
              variant="outline"
              onClick={() =>
                update((current) => ({
                  ...current,
                  settings: {
                    ...current.settings,
                    custom: [...(current.settings.custom ?? []), { key: '', value: '' }],
                  },
                }))
              }
            >
              {t('settings.custom.add')}
            </Button>

            <p className="max-w-prose text-xs text-muted-foreground">{t('settings.custom.syntax')}</p>
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
              <Select
                id="dateFormat"
                value={settings.dateFormat ?? DEFAULT_DATE_FORMAT}
                aria-invalid={issues['settings.dateFormat'] !== undefined}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    settings: { ...current.settings, dateFormat: event.target.value },
                  }))
                }
              >
                {/*
                  Each option is the format rendered, not its instruction set: the
                  question an operator is answering is "which of these looks right",
                  and `%B %-d, %Y` is not an answer to it. The pattern is shown too,
                  for the one person who does want to read the directives.
                */}
                {withCurrentFormat(SITE_DATE_FORMATS, settings.dateFormat ?? '').map((format) => (
                  <option key={format} value={format}>
                    {`${formatDate(PREVIEW_INSTANT, format, { timeZone: siteTimeZone })}  ${format}`}
                  </option>
                ))}
              </Select>
              {issues['settings.dateFormat'] !== undefined && (
                <p className="text-sm text-destructive">{issues['settings.dateFormat']}</p>
              )}
              <p className="text-sm text-muted-foreground">
                {t('settings.dateFormat.preview', { instant: instantLabel, formatted: sitePreview })}
              </p>
              <p className="text-sm text-muted-foreground">{t('settings.dateFormat.directives')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="timezone">{t('settings.timezone')}</Label>
              <Input
                id="timezone"
                list="time-zones"
                value={settings.timezone ?? ''}
                placeholder={DEFAULT_TIME_ZONE}
                aria-invalid={issues['settings.timezone'] !== undefined}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    settings: { ...current.settings, timezone: event.target.value },
                  }))
                }
              />
              <datalist id="time-zones">
                {TIME_ZONES.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
              {issues['settings.timezone'] !== undefined && (
                <p className="text-sm text-destructive">{issues['settings.timezone']}</p>
              )}
              <p className="text-sm text-muted-foreground">{t('settings.timezone.hint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="adminLanguage">{t('settings.adminLanguage')}</Label>
              <Select
                id="adminLanguage"
                value={settings.admin?.language ?? DEFAULT_LANGUAGE}
                onChange={(event) => setAdmin((admin) => ({ ...admin, language: event.target.value }))}
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
              <Select
                id="adminDateFormat"
                value={settings.admin?.dateFormat ?? DEFAULT_ADMIN_DATE_FORMAT}
                aria-invalid={issues['settings.admin.dateFormat'] !== undefined}
                onChange={(event) => setAdmin((admin) => ({ ...admin, dateFormat: event.target.value }))}
              >
                {/*
                  The panel's own clock, so the examples are in the operator's zone
                  rather than the site's: a timestamp in a list is about when they
                  did something, not about how a reader will see it.
                */}
                {withCurrentFormat(ADMIN_DATE_FORMATS, settings.admin?.dateFormat ?? '').map((format) => (
                  <option key={format} value={format}>
                    {`${formatLocal(PREVIEW_INSTANT, format)}  ${format}`}
                  </option>
                ))}
              </Select>
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


      <TabsContent value="paths" forceMount hidden={tab !== 'paths'}>
        <Card>
          <CardHeader>
            <CardDescription>{t('settings.paths.hint')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="adminPath">{t('settings.adminPath')}</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  id="adminPath"
                  className="max-w-xs"
                  value={settings.admin?.path ?? ''}
                  placeholder={DEFAULT_ADMIN_PATH}
                  aria-invalid={issues['settings.admin.path'] !== undefined}
                  onChange={(event) =>
                    update((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        admin: { ...current.settings.admin, path: event.target.value },
                      },
                    }))
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    update((current) => ({
                      ...current,
                      settings: {
                        ...current.settings,
                        admin: { ...current.settings.admin, path: randomAdminPath() },
                      },
                    }))
                  }
                >
                  {t('settings.adminPath.generate')}
                </Button>
              </div>
              {issues['settings.admin.path'] !== undefined && (
                <p className="text-sm text-destructive">{issues['settings.admin.path']}</p>
              )}
              <p className="max-w-prose text-xs text-muted-foreground">{t('settings.adminPath.hint')}</p>
            </div>

            <div className="space-y-2">
              <Label>{t('settings.paths.system')}</Label>
              <ul className="flex flex-wrap gap-1" data-testid="platform-paths">
                {/* The panel's own chip is the address in force rather than the
                    constant: the list answers "what is already taken", and a stale
                    `/admin` would answer it wrongly. */}
                {PLATFORM_PATHS.map((path) => (path === '/admin' ? `/${adminPath}` : path)).map((shown) => (
                  <li key={shown} className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-xs">
                    {shown}
                  </li>
                ))}
              </ul>
              <p className="max-w-prose text-xs text-muted-foreground">{t('settings.paths.system.hint')}</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reservedPaths">{t('settings.paths.mine')}</Label>
              <Textarea
                id="reservedPaths"
                rows={4}
                value={(settings.reservedPaths ?? []).join('\n')}
                onChange={(event) =>
                  update((current) => ({
                    ...current,
                    settings: { ...current.settings, reservedPaths: splitPaths(event.target.value) },
                  }))
                }
              />
              <p className="max-w-prose text-xs text-muted-foreground">{t('settings.paths.mine.hint')}</p>
              {issues['settings.reservedPaths'] !== undefined && (
                <p className="text-sm text-destructive">{issues['settings.reservedPaths']}</p>
              )}
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


/**
 * The document a deployment starts from.
 *
 * Everything optional is left out and everything required is empty, so the form
 * opens on blank fields and the schema is the thing that says a name is needed --
 * the same schema the Worker will apply.
 */
function blankDocument(): SiteWrite {
  return {
    name: '',
    tagline: null,
    logoMediaId: null,
    faviconMediaId: null,
    theme: 'default',
    settings: {
      // A fresh deployment gets an unguessable address by default: it is reachable at
      // `admin` until this is saved, and the operator accepts the suggestion while
      // they are setting everything else up.
      admin: { path: randomAdminPath() },
    },
    nav: [],
  }
}

/**
 * A panel address nobody arrives at by walking a list of words.
 *
 * Ten characters from an alphabet with no look-alikes in it, because the value gets
 * read off one screen and typed into another.
 */
function randomAdminPath(): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)

  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

function toDraft(site: SiteResponse): SiteWrite {
  return {
    name: site.name,
    tagline: site.tagline,
    // Carried through untouched: the form has no way to edit it yet, and the
    // write replaces the whole document.
    logoMediaId: site.logoMediaId,
    faviconMediaId: site.faviconMediaId,
    theme: site.theme,
    settings: {
      ...site.settings,
      accentColor: site.settings.accentColor ?? DEFAULT_ACCENT,
      socialLinks: site.settings.socialLinks ?? [],
    },
    nav: [...site.nav].sort((left, right) => left.order - right.order),
  }
}

/**
 * One path per line, trimmed, with the blanks and the repeats dropped.
 *
 * A textarea is what the operator asked for, and what that means is a list they can
 * paste into from a note. The blanks are how they left room between sections of that
 * note, and a repeat is not two reservations.
 */
function splitPaths(value: string): string[] {
  const paths = value
    .split('\n')
    .map((path) => path.trim())
    .filter((path) => path !== '')

  return [...new Set(paths)]
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

function replaceCustom(
  entries: NonNullable<SiteWrite['settings']['custom']>,
  index: number,
  change: Partial<{ key: string; value: string }>,
): NonNullable<SiteWrite['settings']['custom']> {
  return entries.map((entry, position) => (position === index ? { ...entry, ...change } : entry))
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
