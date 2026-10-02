import type { ThemeContextResponse } from '@typeky/api'
import { useEffect, useState, type ReactNode } from 'react'
import { useApiClient } from '@/lib/client-context'
import { useT } from '@/lib/i18n'
import { describeApiError } from '@/lib/session'

/**
 * What a template may read, and what it may use.
 *
 * A `<details>`, closed by default: it is a reference, and a reference that takes a
 * third of the screen is one that gets in the way of the thing it is about. The
 * summary line is what says it is there.
 *
 * Everything in it comes from the server -- the paths from a real render context,
 * the tags and the filters from the sandbox's own whitelists -- because a list kept
 * beside them here would go on being confident after the platform changed.
 */

/** The order a reader expects, rather than alphabetical. Anything else follows. */
const GROUP_ORDER = ['site', 'page', 'content', 'seo']

export function TemplateReference({ template }: { template: string }): ReactNode {
  const client = useApiClient()
  const t = useT()

  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reference, setReference] = useState<ThemeContextResponse | null>(null)
  const [problem, setProblem] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')

    client
      .getThemeContext(template)
      .then((response) => {
        if (cancelled) return
        setReference(response)
        setState('ready')
      })
      .catch((thrown: unknown) => {
        if (cancelled) return
        setProblem(describeApiError(thrown, t))
        setState('error')
      })

    return () => {
      cancelled = true
    }
  }, [client, template, t])

  /** Grouped by the first segment, which is what a reader looks up by. */
  function groups(paths: string[]): Array<{ head: string; paths: string[] }> {
    const byHead = new Map<string, string[]>()
    for (const path of paths) {
      const head = path.split('.')[0] ?? path
      const list = byHead.get(head)
      if (list === undefined) byHead.set(head, [path])
      else list.push(path)
    }

    const ordered = [...byHead.keys()].sort((left, right) => {
      const a = GROUP_ORDER.indexOf(left)
      const b = GROUP_ORDER.indexOf(right)
      if (a === -1 && b === -1) return left.localeCompare(right)
      if (a === -1) return 1
      if (b === -1) return -1
      return a - b
    })

    return ordered.map((head) => ({ head, paths: byHead.get(head) ?? [] }))
  }

  /** The key when a translation is missing is the key itself; that is not a label. */
  function groupLabel(head: string): string {
    const key = `templateReference.group.${head}`
    const label = t(key)
    return label === key ? head : label
  }

  function chips(values: readonly string[]): ReactNode {
    return (
      <p className="flex flex-wrap gap-1">
        {values.map((value) => (
          <code
            key={value}
            className="rounded-md border bg-muted/40 px-1.5 py-0.5 font-mono text-xs"
          >
            {value}
          </code>
        ))}
      </p>
    )
  }

  return (
    <details className="rounded-lg border px-3 py-2" data-testid="template-reference">
      <summary className="cursor-pointer text-sm font-medium">
        {t('templateReference.title')}
      </summary>

      <div className="space-y-3 pt-3">
        <p className="max-w-prose text-xs text-muted-foreground">{t('templateReference.intro')}</p>

        {state === 'loading' && (
          <p className="text-xs text-muted-foreground">{t('templateReference.loading')}</p>
        )}
        {state === 'error' && <p className="text-sm text-destructive">{problem}</p>}

        {state === 'ready' && reference !== null && (
          <>
            {groups(reference.paths).map((group) => (
              <div key={group.head} className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground">{groupLabel(group.head)}</p>
                {chips(group.paths)}
              </div>
            ))}

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t('templateReference.tags')}
              </p>
              {chips(reference.tags)}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t('templateReference.platformFilters')}
              </p>
              {chips(reference.platformFilters)}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">
                {t('templateReference.nativeFilters')}
              </p>
              {chips(reference.nativeFilters)}
            </div>
          </>
        )}
      </div>
    </details>
  )
}
