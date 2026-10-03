import { UploadIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A file picker that looks like the rest of the panel.
 *
 * The native control is a button whose label is the browser's to write, sitting in a
 * form looking nothing like the `Input` next to it. What is here instead is the
 * accessible pattern the platform already relies on elsewhere: the input stays in
 * the document so a keyboard can reach it, it is hidden rather than removed, and the
 * visible control is a `<label>` for it.
 *
 * `focus-within` is the part that matters and the part that is easy to lose: hiding
 * the input hides its focus ring too, so the ring is drawn on the label while the
 * input has focus. Without it a keyboard user tabs into something they cannot see.
 *
 * The input is cleared after every pick, which is why picking the same file twice
 * still fires. A file input that keeps its value treats the second choice as no
 * change at all.
 */
export function UploadField({
  id,
  label,
  accept,
  disabled = false,
  onPick,
}: {
  id: string
  label: string
  accept: string
  disabled?: boolean
  onPick: (file: File) => void
}): ReactNode {
  return (
    <label
      htmlFor={id}
      className={cn(
        // The same box as `Input` and the same type as `Button`: these sit beside
        // both, and a third look would be the thing that stands out.
        'inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-input px-2.5 text-sm font-medium',
        'transition-colors hover:bg-muted focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        disabled && 'pointer-events-none cursor-not-allowed opacity-50',
      )}
    >
      <input
        id={id}
        type="file"
        accept={accept}
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file !== undefined) onPick(file)
        }}
      />
      <UploadIcon aria-hidden="true" className="size-4" />
      {label}
    </label>
  )
}
