import type { MediaItem, MediaUsage } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PAGE_SIZE, PageHeader, Pager, SearchBox } from '@/components/list-chrome'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { UploadField, type UploadDetails } from '@/components/upload-field'
import { Card, CardContent } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'
import { useT, type Translate } from '@/lib/i18n'

/**
 * The media library.
 *
 * Deleting asks the server what the item is used in first. The schema clears
 * those references rather than refusing the delete, so the count is a warning an
 * operator can weigh -- "used in three posts" is a different decision from
 * "unused" -- and it is fetched rather than assumed.
 */

type LoadState = 'loading' | 'ready' | 'error'

export function MediaSection() {
  const client = useApiClient()
  const t = useT()

  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [items, setItems] = useState<MediaItem[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')

  const [uploading, setUploading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  /**
   * The item whose larger view is open.
   *
   * The grid shows a crop: `object-cover` at a fixed height is what makes a wall of
   * thumbnails scannable, and it is also why a portrait photograph of a document is
   * unreadable there. Looking at a file is a separate act from scanning the list, so
   * it is a separate view.
   */
  const [viewing, setViewing] = useState<MediaItem | null>(null)
  /** The alt text being edited in the viewer, which is not applied until saved. */
  const [altDraft, setAltDraft] = useState('')
  const [savingAlt, setSavingAlt] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')

    client.listMedia({ search, limit: PAGE_SIZE, offset }).then(
      (result) => {
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
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
  }, [client, search, offset, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  async function upload(file: File, details: UploadDetails): Promise<void> {
    setUploading(true)
    try {
      const saved = await client.uploadMedia(file, details)
      toast.success(t('media.uploaded', { name: saved.filename }))
      setOffset(0)
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
      // Reported and rethrown: the upload control keeps the staged file and the
      // typed name, so a retry is one click instead of a second trip through the
      // file picker.
      throw thrown
    } finally {
      setUploading(false)
    }
  }

  async function remove(item: MediaItem) {
    setBusyId(item.id)

    try {
      const usage: MediaUsage = await client.mediaUsages(item.id)

      if (!window.confirm(describeUsage(item, usage, t))) return

      await client.deleteMedia(item.id)
      toast.success(t('media.deleted'))
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE))
      else reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setBusyId(null)
    }
  }

  async function saveAlt(): Promise<void> {
    if (viewing === null) return

    setSavingAlt(true)

    try {
      // Empty means "no alt text", which is a real answer rather than a missing one:
      // the filename takes over, and that is clearer than a sentence saying nothing.
      const saved = await client.updateMedia(viewing.id, {
        altText: altDraft.trim() === '' ? null : altDraft.trim(),
      })
      setViewing(saved)
      setItems((current) => current.map((item) => (item.id === saved.id ? saved : item)))
      toast.success(t('media.altSaved'))
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
    } finally {
      setSavingAlt(false)
    }
  }

  if (state === 'error') {
    return <ErrorState title={t('media.loadFailed')} description={error} onRetry={reload} />
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('media.title')} description={t('media.description')} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          placeholder={t('media.searchPlaceholder')}
          onSubmit={() => {
            setSearch(searchInput.trim())
            setOffset(0)
          }}
        />

          <UploadField
            id="media-grid-upload"
            accept="image/png,image/jpeg,image/webp,image/gif,image/avif,video/mp4,video/webm"
            disabled={uploading}
            onUpload={upload}
          />
      </div>

      {uploading && <p className="text-sm text-muted-foreground">{t('media.uploading')}</p>}

      <Card>
        <CardContent>
          {state === 'loading' && items.length === 0 ? (
            <LoadingState label={t('media.loading')} />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search === ''
                ? t('media.empty')
                : t('media.noMatches', { search })}
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((item) => (
                <li key={item.id} className="overflow-hidden rounded-md border">
                    <button
                      type="button"
                      onClick={() => {
                        setViewing(item)
                        setAltDraft(item.altText ?? '')
                      }}
                      aria-label={t('media.view', { name: item.altText ?? item.filename })}
                      className="block w-full focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <img
                        src={client.mediaContentUrl(item.id)}
                        alt={item.altText ?? item.filename}
                        className="h-36 w-full bg-neutral-100 object-cover"
                      />
                    </button>
                  <div className="space-y-1 p-2">
                    <p className="truncate text-sm font-medium" title={item.filename}>
                      {item.filename}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {describeSize(item.byteSize)}
                      {item.width !== null && item.height !== null
                        ? ` · ${String(item.width)}×${String(item.height)}`
                        : ''}
                    </p>
                    <Button
                      type="button"
                      size="sm"
                      variant="destructive"
                      disabled={busyId === item.id}
                      onClick={() => void remove(item)}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Pager total={total} offset={offset} shown={items.length} onOffset={setOffset} />
        </CardContent>
      </Card>

      <Sheet
        open={viewing !== null}
        onOpenChange={(open) => {
          if (!open) setViewing(null)
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl" data-testid="media-viewer">
          <SheetHeader className="border-b">
            <SheetTitle className="truncate">{viewing?.filename ?? ''}</SheetTitle>
          </SheetHeader>

          {viewing !== null && (
            <div className="space-y-4 p-4">
              {/* `object-contain` rather than a crop: this view exists to show what the
                  thumbnail could not, which for a portrait image is most of it. */}
              <img
                src={client.mediaContentUrl(viewing.id)}
                alt={viewing.altText ?? viewing.filename}
                className="max-h-[70vh] w-full rounded-md bg-neutral-100 object-contain"
              />

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                <dt className="text-muted-foreground">{t('media.viewSize')}</dt>
                <dd>{describeSize(viewing.byteSize)}</dd>

                {viewing.width !== null && viewing.height !== null && (
                  <>
                    <dt className="text-muted-foreground">{t('media.viewDimensions')}</dt>
                    <dd>
                      {viewing.width}×{viewing.height}
                    </dd>
                  </>
                )}
              </dl>

              {/*
                Editable rather than a read-only row: alt text is written for a screen
                reader, and the line an operator had at upload time is often not the line
                they want once they have seen the item in place. Clearing it is a real
                answer, so empty saves as "none" rather than pretending the field was
                never filled.
              */}
              <form
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault()
                  void saveAlt()
                }}
              >
                <Label htmlFor="media-alt">{t('media.viewAlt')}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id="media-alt"
                    className="min-w-0 flex-1"
                    maxLength={300}
                    value={altDraft}
                    disabled={savingAlt}
                    onChange={(event) => setAltDraft(event.target.value)}
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={savingAlt || altDraft === (viewing.altText ?? '')}
                  >
                    {t('media.saveAlt')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t('upload.alt.hint')}</p>
              </form>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  )
}

/**
 * What the confirm dialog says.
 *
 * Naming the places matters more than the total: "used in 3 posts" tells an
 * operator what will break, and "used 3 times" does not.
 */
function describeUsage(item: MediaItem, usage: MediaUsage, t: Translate): string {
  if (usage.total === 0) return t('media.confirmUnused', { name: item.filename })

  // Each place is counted on its own: "used in 1 post, 2 pages" reads as what will
  // change, and the plural of the noun belongs to the language.
  const places = usage.places
    .map((place) => `${String(place.count)} ${t(`media.kind.${place.kind}`, { count: place.count })}`)
    .join(', ')

  return t('media.confirmUsed', { name: item.filename, places })
}

function describeSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
}
