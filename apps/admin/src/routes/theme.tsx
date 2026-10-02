import type { ThemeTemplateGroup, ThemeTemplateSummary } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { TemplateEditorSurface } from '@/components/template-editor-surface'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { ApiError } from '@/lib/api-client'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'
import { usePanelPreference } from '@/lib/panel-preference'
import { useT } from '@/lib/i18n'

/**
 * The theme's templates.
 *
 * What is listed is what the theme ships. There is no way to add a template, and
 * the page says so rather than leaving the absence to be discovered: a site may
 * edit its theme, and a theme upgrade that finds files it did not put there is
 * exactly the conflict this avoids.
 *
 * Reading is what this screen does. Editing the source is the screen after it,
 * and the view here is the same reading experience it will open with.
 */

type LoadState = 'loading' | 'ready' | 'error'

const GROUPS: ReadonlyArray<{ group: ThemeTemplateGroup; titleKey: string; descriptionKey: string }> = [
  {
    group: 'layouts',
    titleKey: 'theme.group.layouts',
    descriptionKey: 'theme.group.layouts.hint',
  },
  {
    group: 'templates',
    titleKey: 'theme.group.templates',
    descriptionKey: 'theme.group.templates.hint',
  },
  {
    group: 'snippets',
    titleKey: 'theme.group.snippets',
    descriptionKey: 'theme.group.snippets.hint',
  },
]

export function ThemeSection() {
  const t = useT()
  const client = useApiClient()
  const panel = usePanelPreference()

  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState('default')
  const [items, setItems] = useState<ThemeTemplateSummary[]>([])
  const [attempt, setAttempt] = useState(0)

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)
  /** The last source the server accepted, so "changed" is answerable. */
  const [saved, setSaved] = useState<string | null>(null)
  const [problem, setProblem] = useState<{ message: string; line: number | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [view, setView] = useState<'source' | 'preview'>('source')
  const [previewHtml, setPreviewHtml] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState('loading')

    client.listThemeTemplates().then(
      (result) => {
        if (cancelled) return
        setTheme(result.theme)
        setItems(result.items)
        setState('ready')
      },
      (thrown: unknown) => {
        if (cancelled) return
        setError(describeApiError(thrown, t))
        setState('error')
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  async function open(path: string) {
    setOpenPath(path)
    setSource(null)
    setSaved(null)
    setProblem(null)
    setView('source')
    setPreviewHtml(null)

    try {
      const template = await client.getThemeTemplate(path)
      setSource(template.source)
      setSaved(template.source)
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
      setOpenPath(null)
    }
  }

  /**
   * Renders the current source, saved or not.
   *
   * The server does the rendering, through the same loader the site uses, so the
   * frame shows what the page would be -- a client-side approximation would be
   * prettier and wrong.
   */
  async function preview() {
    if (openPath === null || source === null) return

    setPreviewing(true)
    setProblem(null)

    try {
      const result = await client.previewThemeTemplate(openPath, source)
      setPreviewHtml(result.html)
      setView('preview')
    } catch (thrown) {
      if (thrown instanceof ApiError && thrown.serverMessage !== undefined) {
        setProblem({ message: thrown.serverMessage, line: thrown.line ?? null })
        setView('source')
      } else {
        toast.error(describeApiError(thrown, t))
      }
    } finally {
      setPreviewing(false)
    }
  }

  async function save() {
    if (openPath === null || source === null) return

    setSaving(true)
    setProblem(null)

    try {
      const template = await client.saveThemeTemplate(openPath, source)
      setSaved(template.source)
      toast.success(t('theme.saved'))
      reload()
    } catch (thrown) {
      if (thrown instanceof ApiError && thrown.serverMessage !== undefined) {
        // The line, when the server could find one. Shown beside the message
        // rather than instead of it: a line without a reason sends the reader
        // hunting for what is wrong with a line that looks fine.
        setProblem({ message: thrown.serverMessage, line: thrown.line ?? null })
      } else {
        toast.error(describeApiError(thrown, t))
      }
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    if (openPath === null) return
    if (!window.confirm(t('theme.restoreConfirm', { path: openPath }))) {
      return
    }

    setSaving(true)
    setProblem(null)

    try {
      await client.resetThemeTemplate(openPath)
      toast.success(t('theme.restored'))

      // Re-reading rather than assuming: what comes back is the baseline, and
      // showing it is how the operator sees that the restore happened.
      const template = await client.getThemeTemplate(openPath)
      setSource(template.source)
      setSaved(template.source)
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setSaving(false)
    }
  }

  if (state === 'error') {
    return <ErrorState title={t('theme.loadFailed')} description={error} onRetry={reload} />
  }

  if (state === 'loading') return <LoadingState label={t('theme.loading')} />

  const customised = items.filter((item) => item.overridden).length
  /** The open template as the list knows it, which is where "overridden" lives. */
  const opened = items.find((item) => item.path === openPath) ?? null

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t('theme.title')}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {customised === 0
            ? t('theme.subtitle.all', { theme })
            : t('theme.subtitle.customised', { customised, total: items.length })}
        </p>
      </div>

      <p className="max-w-prose rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        {t('theme.note')}
      </p>

      {GROUPS.map(({ group, titleKey, descriptionKey }) => {
        const grouped = items.filter((item) => item.group === group)
        if (grouped.length === 0) return null

        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{t(titleKey)}</CardTitle>
              <CardDescription>{t(descriptionKey)}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {grouped.map((item) => (
                  <li key={item.path} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="space-y-0.5">
                      <p className="font-mono text-sm">{item.path}</p>
                      <p className="text-xs text-muted-foreground">
                        {describeSize(item.bytes)}
                        {item.overridden && item.updatedAt !== null
                          ? ` · customised ${panel.format(item.updatedAt)}`
                          : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.overridden && (
                        <span
                          className="rounded-full border px-2 py-0.5 text-xs"
                          data-testid="customised-marker"
                        >
                          {t('theme.customised')}
                        </span>
                      )}
                      <Button type="button" size="sm" variant="outline" onClick={() => void open(item.path)}>
                        {t('theme.edit')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )
      })}

      <Sheet open={openPath !== null} onOpenChange={(next) => (next ? undefined : setOpenPath(null))}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-4xl">
          <SheetHeader className="border-b">
            <SheetTitle className="font-mono">{openPath ?? ''}</SheetTitle>
          </SheetHeader>

          <div className="space-y-3 p-4">
            {source === null ? (
              <LoadingState label={t('theme.loadingTemplate')} />
            ) : (
              <>
                {problem !== null && (
                  <p
                    role="alert"
                    data-testid="template-problem"
                    className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {problem.line !== null && <strong>Line {String(problem.line)}: </strong>}
                    {problem.message}
                  </p>
                )}

                <div className="flex gap-2" role="group" aria-label={t('theme.editorView')}>
                  <Button
                    type="button"
                    size="sm"
                    variant={view === 'source' ? 'default' : 'outline'}
                    aria-pressed={view === 'source'}
                    onClick={() => setView('source')}
                  >
                    {t('theme.source')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={view === 'preview' ? 'default' : 'outline'}
                    aria-pressed={view === 'preview'}
                    disabled={previewing}
                    onClick={() => void preview()}
                  >
                    {previewing ? t('theme.previewing') : t('theme.preview')}
                  </Button>
                </div>

                {view === 'preview' ? (
                  previewHtml === null ? (
                    <LoadingState label={t('theme.previewLoading')} />
                  ) : (
                    /*
                     * Fully sandboxed: no scripts, and no same-origin either.
                     *
                     * The frame renders a page the operator wrote, and an empty
                     * sandbox means even a mistake in it cannot reach the admin's
                     * session, its storage or its DOM. The cost is that relative
                     * assets do not resolve, so the preview is unstyled until the
                     * theme ships stylesheets -- which is a fair trade for a
                     * preview that cannot affect anything.
                     */
                    <iframe
                      title={t('theme.previewTitle')}
                      sandbox=""
                      srcDoc={previewHtml}
                      className="h-[60vh] w-full rounded-md border bg-white"
                      data-testid="template-preview"
                    />
                  )
                ) : (
                  <TemplateEditorSurface
                    key={openPath ?? 'none'}
                    initialSource={source}
                    onChange={setSource}
                    errorLine={problem?.line ?? null}
                    autoFocus
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {source === saved ? t('theme.noChanges') : t('theme.unsaved')}
                  </p>
                  <div className="flex gap-2">
                    {opened?.overridden === true && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => void reset()}
                        disabled={saving}
                      >
                        {t('theme.restore')}
                      </Button>
                    )}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setSource(saved)
                        setProblem(null)
                      }}
                      disabled={source === saved || saving}
                    >
                      {t('theme.discard')}
                    </Button>
                    <Button type="button" onClick={() => void save()} disabled={source === saved || saving}>
                      {saving ? t('editor.saving') : t('theme.save')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function describeSize(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} bytes` : `${(bytes / 1024).toFixed(1)} KB`
}
