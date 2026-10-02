import type { ThemeTemplateGroup, ThemeTemplateSummary } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState } from '@/components/states'
import { TemplateEditorSurface } from '@/components/template-editor-surface'
import { Button } from '@/components/ui/button'
import { ApiError } from '@/lib/api-client'
import { useApiClient } from '@/lib/client-context'
import { usePanelPreference } from '@/lib/panel-preference'
import { useT } from '@/lib/i18n'
import { describeApiError } from '@/lib/session'
import { cn } from '@/lib/utils'

/**
 * The theme's templates.
 *
 * Files on the left, the open one on the right: a theme is a small tree of
 * templates and the thing an operator does here is move between them, which a
 * drawer per file makes into a sequence of open-and-close.
 *
 * What is listed is what the theme ships. There is no way to add a template, and
 * the page says so rather than leaving the absence to be discovered: a site may
 * edit its theme, and a theme upgrade that finds files it did not put there is
 * exactly the conflict this avoids.
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

/**
 * What a file is called inside its folder.
 *
 * The path is `templates/post` and the folder is `templates`, so the tree shows
 * `post` -- the way a file manager does it. The whole path is on the editor
 * beside it, which is where it matters: `templates/post` is what the rest of the
 * platform calls this file, and `snippets/header` is what a template writes in
 * `{% render %}`.
 */
function leafName(path: string): string {
  return path.split('/').at(-1) ?? path
}

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

  /** Folders start open: there are three of them and the files are the point. */
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

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

      <div className="flex flex-col gap-4 md:flex-row md:items-start">
        {/*
          A navigation landmark of two nested lists, and not `role="tree"`.

          The tree role obliges arrow-key navigation between items -- a
          `treeitem` that only responds to Tab is a role that lies to a screen
          reader. These are buttons and links in a list, which is what they
          behave like; the folder is a disclosure because that is what it does.
        */}
        <nav
          aria-label={t('theme.treeLabel')}
          className="rounded-lg border p-2 md:w-64 md:shrink-0"
          data-testid="theme-tree"
        >
          <ul className="space-y-1">
            {GROUPS.map(({ group, titleKey, descriptionKey }) => {
              const grouped = items.filter((item) => item.group === group)
              if (grouped.length === 0) return null

              const expanded = collapsed[group] !== true

              return (
                <li key={group}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setCollapsed((current) => ({ ...current, [group]: expanded }))}
                    className={cn(
                      'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-medium outline-none',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                      'hover:bg-accent/50',
                    )}
                  >
                    <span aria-hidden="true" className="text-muted-foreground">
                      {expanded ? '▾' : '▸'}
                    </span>
                    <span className="flex-1 text-left">{t(titleKey)}</span>
                    <span className="text-xs text-muted-foreground">{grouped.length}</span>
                  </button>

                  {expanded && (
                    <>
                      <p className="px-2 pb-1 pl-7 text-xs text-muted-foreground">{t(descriptionKey)}</p>
                      <ul className="space-y-0.5">
                        {grouped.map((item) => {
                          const isOpen = item.path === openPath

                          return (
                            <li key={item.path}>
                              <button
                                type="button"
                                aria-current={isOpen ? 'true' : undefined}
                                /*
                                 * Stated, because the name computed from the two
                                 * spans runs them together -- "postCustomised",
                                 * which is what a screen reader would read out.
                                 * The visible text is contained in this, so the
                                 * name still matches what is on screen.
                                 */
                                aria-label={
                                  item.overridden
                                    ? `${leafName(item.path)}, ${t('theme.customised')}`
                                    : leafName(item.path)
                                }
                                onClick={() => void open(item.path)}
                                className={cn(
                                  'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 pl-7 text-left text-sm outline-none',
                                  'focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                                  isOpen
                                    ? 'bg-accent font-medium text-accent-foreground'
                                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                                )}
                              >
                                <span className="truncate font-mono">{leafName(item.path)}</span>
                                {item.overridden && (
                                  <span
                                    className="ml-auto shrink-0 rounded-full border px-2 py-0.5 text-xs"
                                    data-testid="customised-marker"
                                  >
                                    {t('theme.customised')}
                                  </span>
                                )}
                              </button>
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        </nav>

        <div className="min-w-0 flex-1 space-y-3">
          {openPath === null ? (
            <EmptyState title={t('theme.pickTemplate')} description={t('theme.pickTemplate.hint')} />
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                <div className="space-y-0.5">
                  <p className="font-mono text-sm" data-testid="open-path">
                    {openPath}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {opened === null ? '' : describeSize(opened.bytes)}
                    {opened !== null && opened.overridden && opened.updatedAt !== null
                      ? ` · ${t('theme.customisedAt', { when: panel.format(opened.updatedAt) })}`
                      : ''}
                  </p>
                </div>

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
              </div>

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
                      key={openPath}
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
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function describeSize(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} bytes` : `${(bytes / 1024).toFixed(1)} KB`
}
