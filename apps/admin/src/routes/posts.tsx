import type { ContentStatus, PostSummary } from '@typeky/api'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'

/**
 * The post list.
 *
 * Filter, search and paging are all server-side, and all three reset the others
 * the way an operator expects: changing the filter or the search term returns to
 * the first page, because the row they were looking at is no longer there.
 *
 * Publishing from here rather than only from the editor is the point of the
 * status endpoint: finishing a draft should not mean opening it.
 */

const PAGE_SIZE = 20

type Status = 'loading' | 'ready' | 'error'

/** `all` is a filter state, not a content status, so it does not go on the wire. */
type StatusFilter = ContentStatus | 'all'

const FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'published', label: 'Published' },
]

export function PostsSection() {
  const client = useApiClient()
  const navigate = useNavigate()

  const [status, setStatus] = useState<Status>('loading')
  const [loadError, setLoadError] = useState('')
  const [items, setItems] = useState<PostSummary[]>([])
  const [total, setTotal] = useState(0)

  const [filter, setFilter] = useState<StatusFilter>('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)

  const [attempt, setAttempt] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')

    client.listPosts({
      ...(filter === 'all' ? {} : { status: filter }),
      ...(search === '' ? {} : { search }),
      limit: PAGE_SIZE,
      offset,
    }).then(
      (result) => {
        if (cancelled) return
        setItems(result.items)
        setTotal(result.total)
        setStatus('ready')
      },
      (thrown: unknown) => {
        if (cancelled) return
        setLoadError(describeApiError(thrown))
        setStatus('error')
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, filter, search, offset, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSearch(searchInput.trim())
    setOffset(0)
  }

  async function toggleStatus(post: PostSummary) {
    setBusyId(post.id)
    try {
      await client.setPostStatus(post.id, post.status === 'published' ? 'draft' : 'published')
      toast.success(post.status === 'published' ? 'Moved back to draft.' : 'Published.')
      reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown))
    } finally {
      setBusyId(null)
    }
  }

  async function remove(post: PostSummary) {
    if (!window.confirm(`Delete “${post.title}”? This cannot be undone.`)) return

    setBusyId(post.id)
    try {
      await client.deletePost(post.id)
      toast.success('Post deleted.')
      // Deleting the only row of a page would otherwise land on an empty list.
      if (items.length === 1 && offset > 0) setOffset(Math.max(0, offset - PAGE_SIZE))
      else reload()
    } catch (thrown) {
      toast.error(describeApiError(thrown))
    } finally {
      setBusyId(null)
    }
  }

  if (status === 'error') {
    return <ErrorState title="Cannot load posts" description={loadError} onRetry={reload} />
  }

  const first = total === 0 ? 0 : offset + 1
  const last = offset + items.length
  const hasPrevious = offset > 0
  const hasNext = last < total

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Posts</h1>
          <p className="text-sm text-muted-foreground">Blog posts, newest first.</p>
        </div>
        <Button type="button" onClick={() => navigate('/posts/new')}>
          New post
        </Button>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div role="group" aria-label="Filter by status" className="flex gap-2">
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              type="button"
              size="sm"
              variant={filter === option.value ? 'default' : 'outline'}
              aria-pressed={filter === option.value}
              onClick={() => {
                setFilter(option.value)
                setOffset(0)
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <form onSubmit={handleSearch} className="flex items-end gap-2">
          <div className="space-y-2">
            <Label htmlFor="post-search">Search</Label>
            <Input
              id="post-search"
              type="search"
              placeholder="Title, slug or excerpt"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      <Card>
        <CardContent>
          {status === 'loading' && items.length === 0 ? (
            <LoadingState label="Loading posts" />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search === ''
                ? 'No posts yet. The first one starts with “New post”.'
                : `Nothing matches “${search}”.`}
            </p>
          ) : (
            <table className="w-full border-collapse text-sm">
              <caption className="sr-only">Posts</caption>
              <thead>
                <tr className="border-b text-left">
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Title
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Slug
                  </th>
                  <th scope="col" className="py-2 pr-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="hidden py-2 pr-3 font-medium sm:table-cell">
                    Updated
                  </th>
                  <th scope="col" className="py-2 font-medium">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((post) => (
                  <tr key={post.id} className="border-b align-top last:border-b-0">
                    <td className="py-3 pr-3">
                      <Link
                        to={`/posts/${post.id}`}
                        className="font-medium underline-offset-4 hover:underline focus-visible:underline"
                      >
                        {post.title}
                      </Link>
                      {post.category !== null && (
                        <p className="text-xs text-muted-foreground">{post.category}</p>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-muted-foreground">{post.slug}</td>
                    <td className="py-3 pr-3">{post.status === 'published' ? 'Published' : 'Draft'}</td>
                    <td className="hidden py-3 pr-3 text-muted-foreground sm:table-cell">
                      {formatDate(post.updatedAt)}
                    </td>
                    <td className="py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyId === post.id}
                          onClick={() => toggleStatus(post)}
                        >
                          {post.status === 'published' ? 'Unpublish' : 'Publish'}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={busyId === post.id}
                          onClick={() => remove(post)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="post-count">
              {total === 0 ? 'No posts' : `${first}–${last} of ${total}`}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!hasPrevious}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!hasNext}
                onClick={() => setOffset(offset + PAGE_SIZE)}
              >
                Next
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
