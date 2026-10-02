import type { MediaItem, MediaUsage } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { PAGE_SIZE, PageHeader, Pager, SearchBox } from '@/components/list-chrome'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

  async function upload(file: File) {
    setUploading(true)
    try {
      await client.uploadMedia(file, { alt: file.name })
      toast.success(t('media.uploaded', { name: file.name }))
      setOffset(0)
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown, t))
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

        <div className="space-y-2">
          <Label htmlFor="media-grid-upload">{t('media.upload')}</Label>
          <Input
            id="media-grid-upload"
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
                  <img
                    src={client.mediaContentUrl(item.id)}
                    alt={item.altText ?? item.filename}
                    className="h-36 w-full bg-neutral-100 object-cover"
                  />
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
