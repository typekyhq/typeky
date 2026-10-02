import type { Block } from '@typeky/core'
import {
  getProductWriteSchema,
  type ContentStatus,
  type ProductResponse,
  type ProductSpec,
  type ProductWrite,
} from '@typeky/api'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { LazyBlockEditor } from '@/components/lazy-block-editor'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ApiError } from '@/lib/api-client'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'

/**
 * The product editor.
 *
 * The gallery and the specification table are edited with buttons rather than
 * drag and drop, which is the same choice the settings screen makes: it works
 * from the keyboard, and the drag library already lives in the block editor.
 *
 * Gallery entries are media ids, typed or pasted. The picker that makes choosing
 * one possible arrives with the media library, so until then the field says
 * where the id comes from rather than pretending to be finished.
 */

type LoadState = 'loading' | 'ready' | 'error'

interface ProductForm {
  title: string
  slug: string
  summary: string
  priceLabel: string
  ctaLabel: string
  ctaUrl: string
  coverMediaId: string
  /** A string in the form, because a number input is empty before it is typed in. */
  sortOrder: string
  gallery: string[]
  specs: ProductSpec[]
  blocks: Block[]
}

const EMPTY_FORM: ProductForm = {
  title: '',
  slug: '',
  summary: '',
  priceLabel: '',
  ctaLabel: '',
  ctaUrl: '',
  coverMediaId: '',
  sortOrder: '0',
  gallery: [],
  specs: [],
  blocks: [],
}

export function ProductEditorPage() {
  const client = useApiClient()
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isNew = id === undefined || id === 'new'

  const [state, setState] = useState<LoadState>(isNew ? 'ready' : 'loading')
  const [loadError, setLoadError] = useState('')
  const [form, setForm] = useState<ProductForm>(EMPTY_FORM)
  const [product, setProduct] = useState<ProductResponse | null>(null)
  const [issues, setIssues] = useState<Record<string, string>>({})
  const [slugError, setSlugError] = useState('')
  const [saving, setSaving] = useState<ContentStatus | null>(null)
  const [attempt, setAttempt] = useState(0)

  const heldId = useRef<string | null>(null)
  const [editorKey, setEditorKey] = useState('new')

  const slugTouched = useRef(false)
  const isNewProduct = product === null

  useEffect(() => {
    if (isNew || id === undefined) return
    if (heldId.current === id) return

    let cancelled = false
    setState('loading')

    client.getProduct(id).then(
      (loaded) => {
        if (cancelled) return
        heldId.current = loaded.id
        setProduct(loaded)
        setForm(toForm(loaded))
        setEditorKey(loaded.id)
        setIssues({})
        setSlugError('')
        setState('ready')
      },
      (thrown: unknown) => {
        if (cancelled) return
        setLoadError(describeApiError(thrown))
        setState('error')
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, id, isNew, attempt])

  const update = useCallback((change: (current: ProductForm) => ProductForm) => {
    setForm((current) => change(current))
  }, [])

  async function handleSave(status: ContentStatus) {
    const candidate = toWrite(form, status)
    const parsed = getProductWriteSchema().safeParse(candidate)
    if (!parsed.success) {
      setIssues(collectIssues(parsed.error.issues))
      toast.error('Some fields need attention.')
      return
    }

    setIssues({})
    setSlugError('')
    setSaving(status)

    try {
      const saved =
        heldId.current === null
          ? await client.createProduct(parsed.data)
          : await client.saveProduct(heldId.current, parsed.data)

      const wasNew = heldId.current === null
      heldId.current = saved.id
      setProduct(saved)
      setForm(toForm(saved))
      setIssues({})

      toast.success(saved.status === 'published' ? 'Published.' : 'Saved as a draft.')
      if (wasNew) navigate(`/products/${saved.id}`, { replace: true })
    } catch (thrown) {
      if (thrown instanceof ApiError && thrown.code === 'slug_taken') {
        setSlugError(thrown.serverMessage ?? 'That slug is already in use.')
        toast.error('That slug is already in use.')
      } else {
        toast.error(describeApiError(thrown))
      }
    } finally {
      setSaving(null)
    }
  }

  async function handleDelete() {
    if (product === null) return
    if (!window.confirm(`Delete “${product.title}”? This cannot be undone.`)) return

    try {
      await client.deleteProduct(product.id)
      toast.success('Product deleted.')
      navigate('/products')
    } catch (thrown) {
      toast.error(describeApiError(thrown))
    }
  }

  if (state === 'error') {
    return (
      <ErrorState
        title="Cannot load this product"
        description={loadError}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    )
  }

  if (state === 'loading') return <LoadingState label="Loading the product" />

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
          <h1 className="text-xl font-semibold">{isNewProduct ? 'New product' : 'Edit product'}</h1>
          <p className="text-sm text-muted-foreground">
            <Link to="/products" className="underline-offset-4 hover:underline">
              Back to products
            </Link>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {product !== null && (
            <Button type="button" variant="destructive" disabled={saving !== null} onClick={handleDelete}>
              Delete
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={saving !== null}
            onClick={() => void handleSave('draft')}
          >
            {saving === 'draft' ? 'Saving…' : 'Save draft'}
          </Button>
          <Button type="submit" disabled={saving !== null}>
            {saving === 'published' ? 'Saving…' : product?.status === 'published' ? 'Update' : 'Publish'}
          </Button>
        </div>
      </div>

      {product !== null && (
        <p className="text-sm text-muted-foreground" data-testid="product-meta">
          {product.status === 'published' ? 'Published' : 'Draft'} · revision {product.revision}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
          <CardDescription>What the list and the product card show.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="title"
            label="Title"
            value={form.title}
            error={issues.title}
            onChange={(value) =>
              update((current) => ({
                ...current,
                title: value,
                ...(slugTouched.current || !isNewProduct ? {} : { slug: slugify(value) }),
              }))
            }
          />
          <Field
            id="slug"
            label="Slug"
            value={form.slug}
            error={slugError !== '' ? slugError : issues.slug}
            hint="Lowercase words separated by hyphens. This is the URL."
            onChange={(value) => {
              slugTouched.current = true
              update((current) => ({ ...current, slug: value }))
            }}
          />
          <Field
            id="priceLabel"
            label="Price"
            value={form.priceLabel}
            error={issues.priceLabel}
            hint="Text, printed as written. There is no built-in checkout."
            onChange={(value) => update((current) => ({ ...current, priceLabel: value }))}
          />
          <Field
            id="sortOrder"
            label="Sort order"
            value={form.sortOrder}
            error={issues.sortOrder}
            hint="Lower sorts first."
            onChange={(value) => update((current) => ({ ...current, sortOrder: value }))}
          />
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="summary">Summary</Label>
            <Textarea
              id="summary"
              value={form.summary}
              aria-invalid={issues.summary !== undefined}
              aria-describedby={issues.summary !== undefined ? 'summary-error' : undefined}
              onChange={(event) => update((current) => ({ ...current, summary: event.target.value }))}
            />
            {issues.summary !== undefined && (
              <p id="summary-error" className="text-sm text-destructive">
                {issues.summary}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Call to action</CardTitle>
          <CardDescription>Where a visitor goes to buy. The link points outside Typeky.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field
            id="ctaLabel"
            label="Button label"
            value={form.ctaLabel}
            error={issues.ctaLabel}
            onChange={(value) => update((current) => ({ ...current, ctaLabel: value }))}
          />
          <Field
            id="ctaUrl"
            label="Button link"
            value={form.ctaUrl}
            error={issues.ctaUrl}
            hint="An absolute URL."
            onChange={(value) => update((current) => ({ ...current, ctaUrl: value }))}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Images</CardTitle>
          <CardDescription>
            Media ids, one per entry. The picker that chooses them arrives with the media library.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field
            id="coverMediaId"
            label="Cover image"
            value={form.coverMediaId}
            error={issues.coverMediaId}
            onChange={(value) => update((current) => ({ ...current, coverMediaId: value }))}
          />

          {form.gallery.length === 0 && (
            <p className="text-sm text-muted-foreground">No gallery images yet.</p>
          )}

          <ol className="space-y-3">
            {form.gallery.map((mediaId, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-48 flex-1">
                  <Field
                    id={`gallery-${String(index)}`}
                    label={`Image ${String(index + 1)}`}
                    value={mediaId}
                    error={issues[`gallery.${String(index)}`]}
                    onChange={(value) =>
                      update((current) => ({
                        ...current,
                        gallery: replaceAt(current.gallery, index, value),
                      }))
                    }
                  />
                </div>
                <RepeaterButtons
                  label={`image ${String(index + 1)}`}
                  index={index}
                  count={form.gallery.length}
                  onMove={(delta) =>
                    update((current) => ({ ...current, gallery: moveAt(current.gallery, index, delta) }))
                  }
                  onRemove={() =>
                    update((current) => ({
                      ...current,
                      gallery: current.gallery.filter((_, position) => position !== index),
                    }))
                  }
                />
              </li>
            ))}
          </ol>

          {issues.gallery !== undefined && <p className="text-sm text-destructive">{issues.gallery}</p>}

          <Button
            type="button"
            variant="outline"
            onClick={() => update((current) => ({ ...current, gallery: [...current.gallery, ''] }))}
          >
            Add image
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Specifications</CardTitle>
          <CardDescription>The table a product template renders.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.specs.length === 0 && (
            <p className="text-sm text-muted-foreground">No specifications yet.</p>
          )}

          <ol className="space-y-3">
            {form.specs.map((spec, index) => (
              <li key={index} className="flex flex-wrap items-end gap-2">
                <div className="min-w-40 flex-1">
                  <Field
                    id={`spec-${String(index)}-label`}
                    label={`Spec ${String(index + 1)} name`}
                    value={spec.label}
                    error={issues[`specs.${String(index)}.label`]}
                    onChange={(value) =>
                      update((current) => ({ ...current, specs: replaceAt(current.specs, index, { ...spec, label: value }) }))
                    }
                  />
                </div>
                <div className="min-w-40 flex-1">
                  <Field
                    id={`spec-${String(index)}-value`}
                    label={`Spec ${String(index + 1)} value`}
                    value={spec.value}
                    error={issues[`specs.${String(index)}.value`]}
                    onChange={(value) =>
                      update((current) => ({ ...current, specs: replaceAt(current.specs, index, { ...spec, value }) }))
                    }
                  />
                </div>
                <RepeaterButtons
                  label={`spec ${String(index + 1)}`}
                  index={index}
                  count={form.specs.length}
                  onMove={(delta) =>
                    update((current) => ({ ...current, specs: moveAt(current.specs, index, delta) }))
                  }
                  onRemove={() =>
                    update((current) => ({
                      ...current,
                      specs: current.specs.filter((_, position) => position !== index),
                    }))
                  }
                />
              </li>
            ))}
          </ol>

          {issues.specs !== undefined && <p className="text-sm text-destructive">{issues.specs}</p>}

          <Button
            type="button"
            variant="outline"
            onClick={() =>
              update((current) => ({ ...current, specs: [...current.specs, { label: '', value: '' }] }))
            }
          >
            Add specification
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Body</CardTitle>
          <CardDescription>The body is stored as blocks, not as markup.</CardDescription>
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

/** Up, down and remove, shared by both repeaters so they behave the same way. */
function RepeaterButtons({
  label,
  index,
  count,
  onMove,
  onRemove,
}: {
  label: string
  index: number
  count: number
  onMove: (delta: number) => void
  onRemove: () => void
}) {
  return (
    <div className="flex gap-1 pb-0.5">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={index === 0}
        aria-label={`Move ${label} up`}
        onClick={() => onMove(-1)}
      >
        ↑
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={index === count - 1}
        aria-label={`Move ${label} down`}
        onClick={() => onMove(1)}
      >
        ↓
      </Button>
      <Button type="button" variant="outline" size="sm" aria-label={`Remove ${label}`} onClick={onRemove}>
        ✕
      </Button>
    </div>
  )
}

function replaceAt<T>(items: T[], index: number, value: T): T[] {
  return items.map((item, position) => (position === index ? value : item))
}

/** Swaps two entries, so the order the buttons show is the order that is stored. */
function moveAt<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta
  if (target < 0 || target >= items.length) return items

  const next = [...items]
  const moved = next[target]!
  next[target] = next[index]!
  next[index] = moved
  return next
}

function toForm(product: ProductResponse): ProductForm {
  return {
    title: product.title,
    slug: product.slug,
    summary: product.summary ?? '',
    priceLabel: product.priceLabel ?? '',
    ctaLabel: product.ctaLabel ?? '',
    ctaUrl: product.ctaUrl ?? '',
    coverMediaId: product.coverMediaId ?? '',
    sortOrder: String(product.sortOrder),
    gallery: product.gallery,
    specs: product.specs,
    blocks: product.blocks,
  }
}

function toWrite(form: ProductForm, status: ContentStatus): ProductWrite {
  const sortOrder = Number(form.sortOrder)
  const text = (value: string): string | null => (value.trim() === '' ? null : value.trim())

  return {
    title: form.title.trim(),
    slug: form.slug.trim(),
    summary: text(form.summary),
    priceLabel: text(form.priceLabel),
    ctaLabel: text(form.ctaLabel),
    ctaUrl: text(form.ctaUrl),
    coverMediaId: text(form.coverMediaId),
    sortOrder: Number.isInteger(sortOrder) && sortOrder >= 0 ? sortOrder : 0,
    // Empty rows are dropped rather than refused: an unfinished row is an
    // intention, not a mistake, and saving should not be blocked by one.
    gallery: form.gallery.map((entry) => entry.trim()).filter((entry) => entry !== ''),
    specs: form.specs
      .map((spec) => ({ label: spec.label.trim(), value: spec.value.trim() }))
      .filter((spec) => spec.label !== '' && spec.value !== ''),
    blocks: form.blocks,
    status,
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
