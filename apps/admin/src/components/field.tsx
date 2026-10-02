import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * One text field: a label, the input, and either the problem or the hint.
 *
 * The error and the hint are mutually exclusive on purpose. They occupy the same
 * line under the input, and showing a hint under a field that is currently
 * refused is the fastest way to have someone read the wrong one.
 *
 * `aria-describedby` is only set when there is something to describe, and
 * `aria-invalid` is what turns the border red -- both of which are the browser's
 * job to announce, not the styling's.
 */
export function Field({
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
      {hint !== undefined && error === undefined && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
    </div>
  )
}
