import type { Block } from '@typeky/core'
import {
  getPostWriteSchema,
  type ContentStatus,
  type PostResponse,
  type PostWrite,
  type SeoMetadata,
} from '@typeky/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { LazyBlockEditor } from '@/components/lazy-block-editor'
import { SeoPanel } from '@/components/seo-panel'
import { MediaField } from '@/components/media-picker'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api-client'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'
import { usePanelPreference } from '@/lib/panel-preference'
import { useT } from '@/lib/i18n'

/**
 * The post editor.
 *
 * The form keeps its text fields as strings and converts on save. Validating the
 * draft as it is typed would flag a field the moment it is emptied, which is not
 * a mistake yet; validating on save is when it is.
 *
 * A slug is derived from the title for a new post only, and only until somebody
 * types one. Changing an existing post's slug silently would break every link to
 * it, which is why the product spec keeps those two cases apart.
 */

type LoadState = 'loading' | 'ready' | 'error'

interface PostForm {
  title: string
  slug: string
  excerpt: string
  category: string
  /** Comma-separated in the form; split into the stored list on save. */
  tags: string
  coverMediaId: string
  /**
   * Carried through untouched.
   *
   * The write replaces the whole document, so a field the form does not edit has
   * to be sent back as it arrived -- omitting it would clear it, which is how a
   * whole-document write turns a missing input into data loss.
   */
  seo: SeoMetadata
  blocks: Block[]
}

const EMPTY_FORM: PostForm = {
  title: '',
  slug: '',
  excerpt: '',
  category: '',
  tags: '',
  coverMediaId: '',
  seo: {},
  blocks: [],
}

export function PostEditorPage() {
  const t = useT()
  const client = useApiClient()
  const panel = usePanelPreference()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isNew = id === undefined || id === 'new'

  const [state, setState] = useState<LoadState>(isNew ? 'ready' : 'loading')
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState<PostForm>(EMPTY_FORM)
  const [post, setPost] = useState<PostResponse | null>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [slugError, setSlugError] = useState('')
  const [saving, setSaving] = useState<ContentStatus | null>(null)
  const [attempt, setAttempt] = useState(0)

  /**
   * Which post the form currently holds.
   *
   * Compared before loading, so the redirect from a new post to its own URL does
   * not fetch the post that was just written and rebuild the editor around it.
   */
  const heldId = useRef<string | null>(null)

  /**
   * Bumped only when a *different* post is opened, never after a save. React
   * reusing the component across two posts would leave the first one's blocks in
   * the editor; keying on this remounts it exactly when it must.
   */
  const [editorKey, setEditorKey] = useState('new')

  const slugTouched = useRef(false)
  const isNewPost = post === null

  useEffect(() => {
    if (isNew || id === undefined) return
    if (heldId.current === id) return

    let cancelled = false
    setState('loading')

    client.getPost(id).then(
      (loaded) => {
        if (cancelled) return
        heldId.current = loaded.id
        setPost(loaded)
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

  const update = useCallback((change: (current: PostForm) => PostForm) => {
    setForm((current) => change(current))
  }, [])

  async function handleSave(status: ContentStatus) {
    const candidate = toWrite(form, status)
    const parsed = getPostWriteSchema().safeParse(candidate)
    if (!parsed.success) {
      setIssues(collectIssues(parsed.error.issues))
      toast.error(t('editor.fieldsNeedAttention'))
      return
    }

    setIssues({})
    setSlugError('')
    setSaving(status)

    try {
      // `heldId` decides which of the two: creating and replacing are the same
      // write, and which one this is comes from whether a post has been saved.
      const saved =
        heldId.current === null
          ? await client.createPost(parsed.data)
          : await client.savePost(heldId.current, parsed.data)

      const wasNew = heldId.current === null
      heldId.current = saved.id
      setPost(saved)
      setForm(toForm(saved))
      setIssues({})

      toast.success(saved.status === 'published' ? t('editor.saved') : t('editor.savedAsDraft'))

      // The URL catches up without a reload, so a refresh resumes this post. The
      // editor is not keyed on it, so nothing is rebuilt underneath the cursor.
      if (wasNew) navigate(`/posts/${saved.id}`, { replace: true })
    } catch (thrown) {
      if (thrown instanceof ApiError && thrown.code === 'slug_taken') {
        // On the field that caused it, not only in a toast that disappears.
        setSlugError(thrown.serverMessage ?? t('editor.slugTaken'))
        toast.error(t('editor.slugTaken'))
      } else {
        toast.error(describeApiError(thrown, t))
      }
    } finally {
      setSaving(null)
    }
  }

  async function handleDelete() {
    if (post === null) return
    if (!window.confirm(t('content.confirmDeleteOne', { title: post.title }))) return

    try {
      await client.deletePost(post.id)
      toast.success(t('posts.deleted'))
      navigate('/posts')
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    }
  }

  if (state === 'error') {
    return (
      <ErrorState
        title={t('postEditor.loadFailed')}
        description={loadError}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    )
  }

  if (state === 'loading') return <LoadingState label={t('postEditor.loading')} />

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        // The primary button always means published: for a new post it says
        // "Publish", and for one already published it says "Update" and keeps it
        // that way. Demoting is what the other button is for.
        void handleSave('published')
      }}
      className="space-y-6"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">{isNewPost ? t('postEditor.new') : t('postEditor.edit')}</h1>
          <p className="text-sm text-muted-foreground">
            <Link to="/posts" className="underline-offset-4 hover:underline">
              {t('content.backToPosts')}
            </Link>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {post !== null && (
            <Button type="button" variant="destructive" disabled={saving !== null} onClick={handleDelete}>
              {t('common.delete')}
            </Button>
          )}
          <Button type="button" variant="outline" disabled={saving !== null} onClick={() => void handleSave('draft')}>
            {saving === 'draft' ? t('editor.saving') : t('editor.saveDraft')}
          </Button>
          <Button type="submit" disabled={saving !== null}>
            {saving === 'published' ? t('editor.saving') : post?.status === 'published' ? t('editor.update') : t('editor.publish')}
          </Button>
        </div>
      </div>

      {post !== null && (
        <p className="text-sm text-muted-foreground" data-testid="post-meta">
          {t('editor.meta', {
            status: post.status === 'published' ? t('common.published') : t('common.draft'),
            revision: post.revision,
            updated: panel.format(post.updatedAt),
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
                // Follows the title only for a new post. An existing post's slug
                // is its URL, and rewriting it would break every inbound link.
                ...(slugTouched.current || !isNewPost ? {} : { slug: slugify(value) }),
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
            id="category"
            label={t('postEditor.category')}
            value={form.category}
            error={issues.category}
            onChange={(value) => update((current) => ({ ...current, category: value }))}
          />
          <Field
            id="tags"
            label={t('postEditor.tags')}
            value={form.tags}
            error={issues.tags}
            hint={t('postEditor.tags.hint')}
            onChange={(value) => update((current) => ({ ...current, tags: value }))}
          />
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="excerpt">{t('postEditor.excerpt')}</Label>
            <Textarea
              id="excerpt"
              value={form.excerpt}
              aria-invalid={issues.excerpt !== undefined}
              aria-describedby={issues.excerpt !== undefined ? 'excerpt-error' : undefined}
              onChange={(event) => update((current) => ({ ...current, excerpt: event.target.value }))}
            />
            {issues.excerpt !== undefined && (
              <p id="excerpt-error" className="text-sm text-destructive">
                {issues.excerpt}
              </p>
            )}
          </div>

          <div className="sm:col-span-2">
            <MediaField
              id="coverMediaId"
              label={t('editor.coverImage')}
              value={form.coverMediaId}
              error={issues.coverMediaId}
              hint={t('postEditor.cover.hint')}
              onChange={(value) => update((current) => ({ ...current, coverMediaId: value }))}
            />
          </div>
        </CardContent>
      </Card>

      <SeoPanel
        idPrefix="post-seo"
        value={form.seo}
        onChange={(seo) => update((current) => ({ ...current, seo }))}
        issues={issues}
        fallback={t('postEditor.seoFallback')}
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

function toForm(post: PostResponse): PostForm {
  return {
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt ?? '',
    category: post.category ?? '',
    tags: post.tags.join(', '),
    coverMediaId: post.coverMediaId ?? '',
    seo: post.seo,
    blocks: post.blocks,
  }
}

function toWrite(form: PostForm, status: ContentStatus): PostWrite {
  const excerpt = form.excerpt.trim()
  const category = form.category.trim()

  return {
    title: form.title.trim(),
    slug: form.slug.trim(),
    // Empty means cleared, and the repository stores that as null rather than as
    // an empty string that would render as a blank line somewhere.
    excerpt: excerpt === '' ? null : excerpt,
    category: category === '' ? null : category,
    coverMediaId: form.coverMediaId.trim() === '' ? null : form.coverMediaId.trim(),
    seo: form.seo,
    tags: form.tags
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag !== ''),
    blocks: form.blocks,
    status,
  }
}

/**
 * A slug out of a title, for a new post.
 *
 * Latin-friendly by design: a title in a script this cannot transliterate
 * produces an empty string and the author supplies their own, which is better
 * than a slug made of dashes.
 */
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
