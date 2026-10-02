import type { Block } from '@typeky/core'
import {
  getPageWriteSchema,
  type ContentStatus,
  type PageResponse,
  type PageWrite,
  type SeoMetadata,
} from '@typeky/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { LazyBlockEditor } from '@/components/lazy-block-editor'
import { SeoPanel } from '@/components/seo-panel'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ApiError } from '@/lib/api-client'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'
import { useT } from '@/lib/i18n'

/**
 * The page editor.
 *
 * Fewer fields than a post: a page has no excerpt, category or tags. It has a
 * sort order instead, and it can be made the home page -- which is an action
 * here as well as on the list, because "make this the home page" is something
 * you decide while looking at the page.
 */

type LoadState = 'loading' | 'ready' | 'error'

interface PageForm {
  title: string
  slug: string
  /** A string in the form, because a number input is empty before it is typed in. */
  sortOrder: string
  /**
   * Carried through untouched: the write replaces the whole document, so a field
   * the form does not edit still has to be sent back or it is cleared.
   */
  seo: SeoMetadata
  blocks: Block[]
}

const EMPTY_FORM: PageForm = { title: '', slug: '', sortOrder: '0', seo: {}, blocks: [] }

export function PageEditorPage() {
  const client = useApiClient()
  const t = useT()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isNew = id === undefined || id === 'new'

  const [state, setState] = useState<LoadState>(isNew ? 'ready' : 'loading')
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState<PageForm>(EMPTY_FORM)
  const [page, setPage] = useState<PageResponse | null>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [slugError, setSlugError] = useState('')
  const [saving, setSaving] = useState<ContentStatus | null>(null)
  const [attempt, setAttempt] = useState(0)

  /** Which page the form holds, so the redirect after a create does not refetch it. */
  const heldId = useRef<string | null>(null)
  /** Bumped only when a *different* page is opened, never after a save. */
  const [editorKey, setEditorKey] = useState('new')

  const slugTouched = useRef(false)
  const isNewPage = page === null

  useEffect(() => {
    if (isNew || id === undefined) return
    if (heldId.current === id) return

    let cancelled = false
    setState('loading')

    client.getPage(id).then(
      (loaded) => {
        if (cancelled) return
        heldId.current = loaded.id
        setPage(loaded)
        setForm(toForm(loaded))
        setEditorKey(loaded.id)
        setIssues({})
        setSlugError('')
        setState('ready')
      },
      (thrown: unknown) => {
        if (cancelled) return
        setLoadError(describeApiError(thrown, t))
        setState('error')
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, id, isNew, attempt])

  const update = useCallback((change: (current: PageForm) => PageForm) => {
    setForm((current) => change(current))
  }, [])

  async function handleSave(status: ContentStatus) {
    const candidate = toWrite(form, status)
    const parsed = getPageWriteSchema().safeParse(candidate)
    if (!parsed.success) {
      setIssues(collectIssues(parsed.error.issues))
      toast.error(t('editor.fieldsNeedAttention'))
      return
    }

    setIssues({})
    setSlugError('')
    setSaving(status)

    try {
      const saved =
        heldId.current === null
          ? await client.createPage(parsed.data)
          : await client.savePage(heldId.current, parsed.data)

      const wasNew = heldId.current === null
      heldId.current = saved.id
      setPage(saved)
      setForm(toForm(saved))
      setIssues({})

      toast.success(saved.status === 'published' ? t('editor.saved') : t('editor.savedAsDraft'))
      if (wasNew) navigate(`/pages/${saved.id}`, { replace: true })
    } catch (thrown) {
      if (thrown instanceof ApiError && thrown.code === 'slug_taken') {
        setSlugError(thrown.serverMessage ?? t('editor.slugTaken'))
        toast.error(t('editor.slugTaken'))
      } else {
        toast.error(describeApiError(thrown, t))
      }
    } finally {
      setSaving(null)
    }
  }

  async function makeHome() {
    if (page === null) return

    try {
      const saved = await client.setPageHome(page.id)
      setPage(saved)
      toast.success(t('pageEditor.nowHome'))
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    }
  }

  async function handleDelete() {
    if (page === null) return
    if (!window.confirm(t('content.confirmDeleteOne', { title: page.title }))) return

    try {
      await client.deletePage(page.id)
      toast.success(t('pages.deleted'))
      navigate('/pages')
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    }
  }

  if (state === 'error') {
    return (
      <ErrorState
        title={t('pageEditor.loadFailed')}
        description={loadError}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    )
  }

  if (state === 'loading') return <LoadingState label={t('pageEditor.loading')} />

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        void handleSave('published')
      }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{isNewPage ? t('pageEditor.new') : t('pageEditor.edit')}</h1>
          <p className="text-sm text-muted-foreground">
            <Link to="/pages" className="underline-offset-4 hover:underline">
              {t('content.backToPages')}
            </Link>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {page !== null && (
            <>
              {!page.isHome && (
                <Button type="button" variant="ghost" disabled={saving !== null} onClick={makeHome}>
                  {t('pages.setAsHome')}
                </Button>
              )}
              <Button type="button" variant="destructive" disabled={saving !== null} onClick={handleDelete}>
                {t('common.delete')}
              </Button>
            </>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={saving !== null}
            onClick={() => void handleSave('draft')}
          >
            {saving === 'draft' ? t('editor.saving') : t('editor.saveDraft')}
          </Button>
          <Button type="submit" disabled={saving !== null}>
            {saving === 'published' ? t('editor.saving') : page?.status === 'published' ? t('editor.update') : t('editor.publish')}
          </Button>
        </div>
      </div>

      {page !== null && (
        <p className="text-sm text-muted-foreground" data-testid="page-meta">
          {t('editor.pageMeta', {
            home: page.isHome ? t('pageEditor.isHome') : t('pageEditor.notHome'),
            status: page.status === 'published' ? t('common.published') : t('common.draft'),
            revision: page.revision,
          })}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('editor.details')}</CardTitle>
          <CardDescription>{t('editor.details.hint')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="title"
            label={t('editor.title')}
            value={form.title}
            error={issues.title}
            onChange={(value) =>
              update((current) => ({
                ...current,
                title: value,
                // A new page's slug follows its title until somebody types one.
                ...(slugTouched.current || !isNewPage ? {} : { slug: slugify(value) }),
              }))
            }
          />
          <Field
            id="slug"
            label={t('editor.slug')}
            value={form.slug}
            error={slugError !== '' ? slugError : issues.slug}
            hint={t('editor.slug.hint')}
            onChange={(value) => {
              slugTouched.current = true
              update((current) => ({ ...current, slug: value }))
            }}
          />
          <Field
            id="sortOrder"
            label={t('editor.sortOrder')}
            value={form.sortOrder}
            error={issues.sortOrder}
            hint={t('pageEditor.sortOrder.hint')}
            onChange={(value) => update((current) => ({ ...current, sortOrder: value }))}
          />
        </CardContent>
      </Card>

      <SeoPanel
        idPrefix="page-seo"
        value={form.seo}
        onChange={(seo) => update((current) => ({ ...current, seo }))}
        issues={issues}
        fallback={t('pageEditor.seoFallback')}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t('editor.body')}</CardTitle>
          <CardDescription>{t('editor.body.hint')}</CardDescription>
        </CardHeader>
        <CardContent>
          <LazyBlockEditor
            key={editorKey}
            initialBlocks={form.blocks}
            onChange={(blocks) => update((current) => ({ ...current, blocks }))}
          />
        </CardContent>
      </Card>
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
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        aria-invalid={error !== undefined}
        aria-describedby={error !== undefined ? `${id}-error` : undefined}
        onChange={(event) => onChange(event.target.value)}
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

function toForm(page: PageResponse): PageForm {
  return {
    title: page.title,
    slug: page.slug,
    sortOrder: String(page.sortOrder),
    seo: page.seo,
    blocks: page.blocks,
  }
}

function toWrite(form: PageForm, status: ContentStatus): PageWrite {
  const sortOrder = Number(form.sortOrder)

  return {
    title: form.title.trim(),
    slug: form.slug.trim(),
    status,
    // A blank or unparseable order means zero rather than a validation error:
    // the field is a convenience, and getting it wrong should not block a save.
    sortOrder: Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
    seo: form.seo,
    blocks: form.blocks,
  }
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
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
