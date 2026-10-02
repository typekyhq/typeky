import type { ContentStatus } from '@typeky/api'
import type { FormEvent, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * The chrome the three content lists share.
 *
 * Not the fetching and not the rows: those differ enough per resource that
 * sharing them would mean a generic component with a callback for everything,
 * which is harder to read than two short screens. What is here is the parts
 * that are word for word identical and where drifting apart would be a bug --
 * the filter semantics, the paging arithmetic, and the labels.
 */

export type StatusFilter = ContentStatus | 'all'

const FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Published' },
]

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="max-w-prose text-sm text-muted-foreground">{description}</p>
      </div>
      {children !== undefined && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  )
}

export function StatusFilterGroup({
  value,
  onChange,
}: {
  value: StatusFilter
  onChange: (next: StatusFilter) => void
}) {
  return (
    <div role="group" aria-label="Filter by status" className="flex gap-2">
      {FILTERS.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={value === option.value ? 'default' : 'outline'}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

/**
 * Searches on submit rather than on every keystroke.
 *
 * Each keystroke would be a round trip over a query that is not finished yet,
 * and on a slow connection the answers can arrive out of order.
 */
export function SearchBox({
  value,
  onChange,
  onSubmit,
  placeholder,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  placeholder: string
}) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2">
      <div className="space-y-2">
        <Label htmlFor="content-search">Search</Label>
        <Input
          id="content-search"
          type="search"
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      <Button type="submit" variant="outline">
        Search
      </Button>
    </form>
  )
}

export function Pager({
  total,
  offset,
  shown,
  onOffset,
}: {
  total: number
  offset: number
  shown: number
  onOffset: (next: number) => void
}) {
  const first = total === 0 ? 0 : offset + 1
  const last = offset + shown

  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted-foreground" data-testid="content-count">
        {total === 0 ? 'Nothing here' : `${first}–${last} of ${total}`}
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={offset === 0}
          onClick={() => onOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Previous
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={last >= total}
          onClick={() => onOffset(offset + PAGE_SIZE)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}

export const PAGE_SIZE = 20

/** One row's actions, so every list offers the same two in the same order. */
export function RowActions({
  status,
  busy,
  onToggleStatus,
  onDelete,
  extra,
}: {
  status: ContentStatus
  busy: boolean
  onToggleStatus: () => void
  onDelete: () => void
  extra?: ReactNode
}) {
  return (
    <div className="flex justify-end gap-2">
      {extra}
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onToggleStatus}>
        {status === 'published' ? 'Unpublish' : 'Publish'}
      </Button>
      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
        Delete
      </Button>
    </div>
  )
}

/** The status cell, spelled out rather than shown as a colour alone. */
export function StatusText({ status }: { status: ContentStatus }) {
  return <span>{status === 'published' ? 'Published' : 'Draft'}</span>
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}
