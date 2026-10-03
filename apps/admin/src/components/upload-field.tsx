import { UploadIcon } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

/**
 * Choosing a file, naming it, and only then uploading it.
 *
 * The two things an upload needs are the two the browser does not ask for: what
 * the file should be called once it is in the library, and what the image *is* for
 * somebody who cannot see it. Uploading on the file picker's own event meant both
 * were decided for the operator -- the filename was whatever the camera produced,
 * and the alt text was that filename repeated.
 *
 * So a picked file is **staged**, not sent: the panel below shows what was chosen
 * and the two fields, and the upload happens on a button. `onUpload` resolves when
 * it worked; a rejection leaves the panel and the typed values in place, because a
 * failed upload should cost one click to retry rather than choosing the file again.
 *
 * The native input stays in the document so a keyboard can reach it -- hidden
 * rather than removed, with the focus ring drawn on the label through
 * `focus-within`. Without that, a keyboard user tabs into something invisible.
 */
export interface UploadDetails {
  /** What the file is called in the library, and when it is downloaded. */
  filename: string
  /** The alt text, or an empty string to leave it unset. */
  alt: string
}

export function UploadField({
  id,
  accept,
  disabled = false,
  onUpload,
}: {
  id: string
  accept: string
  disabled?: boolean
  onUpload: (file: File, details: UploadDetails) => Promise<void>
}): ReactNode {
  const t = useT()
  const [picked, setPicked] = useState<File | null>(null)
  const [filename, setFilename] = useState('')
  const [alt, setAlt] = useState('')
  const [busy, setBusy] = useState(false)

  const blocked = disabled || busy

  function choose(file: File): void {
    setPicked(file)
    // The original name is usually already the right one, so it is what the field
    // starts with rather than a placeholder the operator has to retype.
    setFilename(file.name)
    // Deliberately empty. An alt that repeats the filename is the one alt text
    // that never helps anybody, and a prefilled one is a value nobody edits.
    setAlt('')
  }

  async function confirm(): Promise<void> {
    if (picked === null) return

    setBusy(true)

    try {
      // A name cleared by accident falls back to the file's own: an empty filename
      // in the library is worse than the one the camera wrote.
      await onUpload(picked, { filename: filename.trim() || picked.name, alt: alt.trim() })
      setPicked(null)
      setFilename('')
      setAlt('')
    } catch {
      // The caller has already reported the reason; this only stays open.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2">
      <label
        htmlFor={id}
        className={cn(
          // The same box as `Input` and the same type as `Button`: these sit beside
          // both, and a third look would be the thing that stands out.
          'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm font-medium',
          'transition-colors hover:bg-muted focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
          blocked && 'pointer-events-none cursor-not-allowed opacity-50',
        )}
      >
        <input
          id={id}
          type="file"
          accept={accept}
          disabled={blocked}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file !== undefined) choose(file)
          }}
        />
        <UploadIcon aria-hidden="true" className="size-4" />
        {t('upload.choose')}
      </label>

      {picked !== null && (
        <div className="space-y-3 rounded-lg border border-input bg-muted/40 p-3">
          <p className="text-sm text-muted-foreground">{t('upload.chosen', { name: picked.name })}</p>

          <div className="space-y-2">
            <Label htmlFor={`${id}-filename`}>{t('upload.filename')}</Label>
            <Input
              id={`${id}-filename`}
              value={filename}
              disabled={busy}
              onChange={(event) => setFilename(event.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor={`${id}-alt`}>{t('upload.alt')}</Label>
            <Input
              id={`${id}-alt`}
              value={alt}
              disabled={busy}
              onChange={(event) => setAlt(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('upload.alt.hint')}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={blocked} onClick={() => void confirm()}>
              {t('upload.start')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setPicked(null)}
            >
              {t('upload.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
