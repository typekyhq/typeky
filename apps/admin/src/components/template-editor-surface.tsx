import { useEffect, useRef } from 'react'
import type { TemplateEditorProps } from '@/lib/template-editor'

/**
 * The template editor, as React sees it.
 *
 * CodeMirror owns its own DOM and its own state, so the component mounts it once
 * and pushes later changes in through its methods rather than re-rendering it.
 * A controlled CodeMirror would rebuild the document on every keystroke and take
 * the cursor with it.
 */
export function TemplateEditorSurface({
  initialSource,
  onChange,
  errorLine,
  autoFocus,
}: TemplateEditorProps) {
  const parent = useRef<HTMLDivElement>(null)
  const editor = useRef<{ markError(line: number | null): void; destroy(): void } | null>(null)

  // The latest callback, so a parent re-render does not rebuild the editor.
  const latest = useRef(onChange)
  latest.current = onChange

  useEffect(() => {
    let instance: { markError(line: number | null): void; destroy(): void } | null = null
    let cancelled = false

    void (async () => {
      // The import is inside the effect so the whole package lands in its own
      // chunk rather than the screen's.
      const { TemplateEditor } = await import('@/lib/template-editor')
      if (cancelled || parent.current === null) return

      instance = new TemplateEditor(parent.current, {
        initialSource,
        autoFocus,
        onChange: (source) => latest.current(source),
      })
      editor.current = instance
    })()

    return () => {
      cancelled = true
      instance?.destroy()
      editor.current = null
    }
    // Mount once. The source only changes when the screen keys this component.
  }, [initialSource, autoFocus])

  useEffect(() => {
    editor.current?.markError(errorLine ?? null)
  }, [errorLine])

  return <div ref={parent} className="min-h-64" data-testid="template-editor" />
}
