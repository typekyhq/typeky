import type { MediaItem } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useApiClient } from '@/lib/client-context'
import { useT } from '@/lib/i18n'
import { describeApiError } from '@/lib/session'

/**
 * Picking a piece of media.
 *
 * A panel rather than a page, because choosing an image happens *inside* editing
 * something else and navigating away would abandon the form. It offers the same
 * two things the media screen does -- upload, or pick an existing one -- because
 * the moment an operator needs an image that is not there yet is exactly the
 * moment they have the file open.
 */

const PAGE_SIZE = 24

export interface MediaPickerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSelect: (item: MediaItem) => void
  /** Shown above the grid, so it is clear which field is being filled. */
  title?: string
}

export function MediaPicker({ open, onOpenChange, onSelect, title }: MediaPickerProps) {
  const t = useT()
  const client = useApiClient()

  const [items, setItems] = useState<MediaItem[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setState('loading')

    client.listMedia({ search, limit: PAGE_SIZE }).then(
      (result) => {
        if (cancelled) return
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
  }, [client, open, search, attempt])

  const upload = useCallback(
    async (file: File) => {
      setUploading(true)
      try {
        const item = await client.uploadMedia(file, { alt: file.name })
        toast.success(`${file.name} uploaded.`)
        onSelect(item)
        onOpenChange(false)
      } catch (thrown) {
        toast.error(describeApiError(thrown, t))
      } finally {
        setUploading(false)
      }
    },
    [client, onSelect, onOpenChange],
  )

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>{title ?? t('mediaPicker.defaultTitle')}</SheetTitle>
        </SheetHeader>

        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <form
              className="flex flex-1 items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                setSearch(searchInput.trim())
              }}
            >
              <div className="flex-1 space-y-2">
                <Label htmlFor="media-search">{t('mediaPicker.search')}</Label>
                <Input
                  id="media-search"
                  type="search"
                  placeholder={t('mediaPicker.searchPlaceholder')}
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                />
              </div>
              <Button type="submit" variant="outline">
                {t('mediaPicker.search')}
              </Button>
            </form>

            <div className="space-y-2">
              <Label htmlFor="media-upload">{t('mediaPicker.upload')}</Label>
              <Input
                id="media-upload"
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (file !== undefined) void upload(file)
                }}
              />
            </div>
          </div>

          {uploading && <p className="text-sm text-muted-foreground">{t('mediaPicker.uploading')}</p>}

          {state === 'error' ? (
            <ErrorState
              title={t('mediaPicker.loadFailed')}
              description={error}
              onRetry={() => setAttempt((value) => value + 1)}
            />
          ) : state === 'loading' ? (
            <LoadingState label={t('mediaPicker.loading')} />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search === '' ? t('mediaPicker.empty') : t('mediaPicker.noMatches', { search })}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="w-full overflow-hidden rounded-md border text-left hover:border-neutral-400 focus-visible:outline focus-visible:outline-2"
                    onClick={() => {
                      onSelect(item)
                      onOpenChange(false)
                    }}
                  >
                    <img
                      src={client.mediaContentUrl(item.id)}
                      alt={item.altText ?? item.filename}
                      className="h-32 w-full bg-neutral-100 object-cover"
                    />
                    <span className="block truncate px-2 py-1 text-xs">{item.filename}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * A media id with a way to choose one.
 *
 * The text input stays: the id is what is stored, and being able to see and
 * paste it is what makes the field debuggable when an image does not appear.
 */
export function MediaField({
  id,
  label,
  value,
  onChange,
  hint,
  error,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  hint?: string
  error?: string
}) {
  const t = useT()
  const client = useApiClient()
  const [open, setOpen] = useState(false)

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>

      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          aria-invalid={error !== undefined}
          aria-describedby={error !== undefined ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button
          type="button"
          variant="outline"
          // Names the field it fills. "Choose" alone is ambiguous the moment a
          // page has two of them, both to a screen reader and to voice control.
          aria-label={`Choose ${label.toLowerCase()}`}
          onClick={() => setOpen(true)}
        >
          {t('mediaPicker.choose')}
        </Button>
      </div>

      {value !== '' && (
        <img
          src={client.mediaContentUrl(value)}
          alt=""
          className="h-16 w-24 rounded border bg-neutral-100 object-cover"
        />
      )}

      {error !== undefined && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
      {hint !== undefined && error === undefined && <p className="text-xs text-muted-foreground">{hint}</p>}

      <MediaPicker
        open={open}
        onOpenChange={setOpen}
        title={t('mediaPicker.chooseFor', { field: label.toLowerCase() })}
        onSelect={(item) => onChange(item.id)}
      />
    </div>
  )
}
