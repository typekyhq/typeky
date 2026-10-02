import type { ThemeTemplateGroup, ThemeTemplateSummary } from '@typeky/api'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, LoadingState } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useApiClient } from '@/lib/client-context'
import { describeApiError } from '@/lib/session'

/**
 * The theme's templates.
 *
 * What is listed is what the theme ships. There is no way to add a template, and
 * the page says so rather than leaving the absence to be discovered: a site may
 * edit its theme, and a theme upgrade that finds files it did not put there is
 * exactly the conflict this avoids.
 *
 * Reading is what this screen does. Editing the source is the screen after it,
 * and the view here is the same reading experience it will open with.
 */

type LoadState = 'loading' | 'ready' | 'error'

const GROUPS: ReadonlyArray<{ group: ThemeTemplateGroup; title: string; description: string }> = [
  {
    group: 'layouts',
    title: 'Layouts',
    description: 'The page shell. A template renders into one of these.',
  },
  {
    group: 'templates',
    title: 'Templates',
    description: 'One per kind of page, chosen by the URL that was asked for.',
  },
  {
    group: 'snippets',
    title: 'Snippets',
    description: 'Reusable pieces, pulled in by name from the templates and each other.',
  },
]

export function ThemeSection() {
  const client = useApiClient()

  const [state, setState] = useState<LoadState>('loading')
  const [error, setError] = useState('')
  const [theme, setTheme] = useState('default')
  const [items, setItems] = useState<ThemeTemplateSummary[]>([])
  const [attempt, setAttempt] = useState(0)

  const [openPath, setOpenPath] = useState<string | null>(null)
  const [source, setSource] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')

    client.listThemeTemplates().then(
      (result) => {
        if (cancelled) return
        setTheme(result.theme)
        setItems(result.items)
        setState('ready')
      },
      (thrown: unknown) => {
        if (cancelled) return
        setError(describeApiError(thrown))
        setState('error')
      },
    )

    return () => {
      cancelled = true
    }
  }, [client, attempt])

  const reload = useCallback(() => setAttempt((value) => value + 1), [])

  async function open(path: string) {
    setOpenPath(path)
    setSource(null)

    try {
      const template = await client.getThemeTemplate(path)
      setSource(template.source)
    } catch (thrown) {
      toast.error(describeApiError(thrown))
      setOpenPath(null)
    }
  }

  if (state === 'error') {
    return <ErrorState title="Cannot load the theme" description={error} onRetry={reload} />
  }

  if (state === 'loading') return <LoadingState label="Loading the theme" />

  const customised = items.filter((item) => item.overridden).length

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Theme</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          {customised === 0
            ? `Every template is the one the ${theme} theme ships.`
            : `${String(customised)} of ${String(items.length)} templates have been customised.`}
        </p>
      </div>

      <p className="max-w-prose rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
        You can edit the templates your theme ships, and only those. There is no way to add a new
        one: a theme upgrade that found files it did not put there is the conflict this avoids.
      </p>

      {GROUPS.map(({ group, title, description }) => {
        const grouped = items.filter((item) => item.group === group)
        if (grouped.length === 0) return null

        return (
          <Card key={group}>
            <CardHeader>
              <CardTitle>{title}</CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="divide-y">
                {grouped.map((item) => (
                  <li key={item.path} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="space-y-0.5">
                      <p className="font-mono text-sm">{item.path}</p>
                      <p className="text-xs text-muted-foreground">
                        {describeSize(item.bytes)}
                        {item.overridden && item.updatedAt !== null
                          ? ` · customised ${new Date(item.updatedAt).toLocaleString()}`
                          : ''}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.overridden && (
                        <span
                          className="rounded-full border px-2 py-0.5 text-xs"
                          data-testid="customised-marker"
                        >
                          Customised
                        </span>
                      )}
                      <Button type="button" size="sm" variant="outline" onClick={() => void open(item.path)}>
                        View
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )
      })}

      <Sheet open={openPath !== null} onOpenChange={(next) => (next ? undefined : setOpenPath(null))}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-3xl">
          <SheetHeader className="border-b">
            <SheetTitle className="font-mono">{openPath ?? ''}</SheetTitle>
          </SheetHeader>
          <div className="p-4">
            {source === null ? (
              <LoadingState label="Loading the template" />
            ) : (
              <pre className="overflow-x-auto rounded-md border bg-neutral-50 p-3 font-mono text-xs leading-relaxed">
                {source}
              </pre>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

function describeSize(bytes: number): string {
  return bytes < 1024 ? `${String(bytes)} bytes` : `${(bytes / 1024).toFixed(1)} KB`
}
