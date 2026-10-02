import type { BulkResult, ContentSort, ContentStatus, SortDirection } from '@typeky/api'
import { type FormEvent, type ReactNode, useEffect, useRef } from 'react'
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

/** The sort choices a list offers: the key and the direction, as one value. */
export interface SortChoice {
  /** `key:direction`, which is what the select holds. */
  value: string
  key: ContentSort
  direction: SortDirection
  label: string
}

export const SORT_DIRECTIONS_LIST: readonly SortDirection[] = ['asc', 'desc']

/**
 * One control for two values.
 *
 * The select holds `key:direction` rather than a separate direction toggle:
 * sorting by a column and choosing which way is one decision, and a second
 * control would let the two disagree in the URL.
 */
export function SortSelect({
  choices,
  value,
  onChange,
}: {
  choices: readonly SortChoice[]
  value: string
  onChange: (next: SortChoice) => void
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor="list-sort">Sort</Label>
      <select
        id="list-sort"
        className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        value={value}
        onChange={(event) => {
          const next = choices.find((choice) => choice.value === event.target.value)
          if (next !== undefined) onChange(next)
        }}
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  )
}

/**
 * The select-all control.
 *
 * The indeterminate state matters: with some of the page selected, a ticked box
 * would claim all of it is and an empty one would claim none is.
 */
export function SelectionHead({
  allSelected,
  someSelected,
  onChange,
}: {
  allSelected: boolean
  someSelected: boolean
  onChange: (next: boolean) => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = someSelected && !allSelected
  }, [someSelected, allSelected])

  return (
    <th scope="col" className="w-8 py-2 pr-2">
      <input
        ref={ref}
        type="checkbox"
        className="size-4 align-middle"
        checked={allSelected}
        aria-label="Select everything on this page"
        onChange={(event) => onChange(event.target.checked)}
      />
    </th>
  )
}

export function SelectionCell({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <td className="py-3 pr-2">
      <input
        type="checkbox"
        className="size-4 align-middle"
        checked={checked}
        aria-label={`Select ${label}`}
        onChange={(event) => onChange(event.target.checked)}
      />
    </td>
  )
}

/**
 * What can be done with a selection.
 *
 * Shown only when there is one, so the list of a hundred looks the same as the
 * list of one until it matters.
 */
export function BulkBar({
  count,
  busy,
  onPublish,
  onDraft,
  onDelete,
  onClear,
}: {
  count: number
  busy: boolean
  onPublish: () => void
  onDraft: () => void
  onDelete: () => void
  onClear: () => void
}) {
  if (count === 0) return null

  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/40 px-3 py-2"
      data-testid="bulk-bar"
    >
      <span className="text-sm font-medium">
        {count} selected
      </span>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onPublish}>
        Publish
      </Button>
      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onDraft}>
        Move to draft
      </Button>
      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={onDelete}>
        Delete
      </Button>
      <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onClear}>
        Clear
      </Button>
    </div>
  )
}


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

export function describeBulk(result: BulkResult): string {
  if (result.changed === result.requested) {
    return `${String(result.changed)} ${result.changed === 1 ? 'item' : 'items'} updated.`
  }

  // The selection is made in a browser and can be stale, so saying how many were
  // actually there is more useful than reporting what was asked for.
  return `${String(result.changed)} of ${String(result.requested)} changed; the rest were already gone.`
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
