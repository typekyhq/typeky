import { useState } from 'react'
import { LazyBlockEditor } from '@/components/lazy-block-editor'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * The Pages section.
 *
 * Only as far as it can honestly go: the editor is real and fully usable, while
 * the list, the loading of an existing page and the save are the content work
 * that comes next. Saying so on the page is better than a screen that looks
 * finished and silently drops what you wrote.
 */
export function PagesSection() {
  const [blocks, setBlocks] = useState(0)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Pages</h1>
        <p className="max-w-prose text-sm text-muted-foreground">
          Standalone pages, including the one marked as the home page.
        </p>
      </div>

      <Alert>
        <AlertTitle>Editing only, for now</AlertTitle>
        <AlertDescription>
          The editor below is the real one. Loading an existing page and saving it arrive with the
          content work; nothing typed here is stored yet.
        </AlertDescription>
      </Alert>

      <LazyBlockEditor onChange={(document) => setBlocks(document.content?.length ?? 0)} />

      <p className="text-sm text-muted-foreground" data-testid="block-count">
        {blocks} top-level {blocks === 1 ? 'block' : 'blocks'}
      </p>
    </div>
  )
}
