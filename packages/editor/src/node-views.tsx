import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import type { ChangeEvent } from 'react'
import type { CtaAttributes } from './extensions/cta'

/**
 * Block-level UI for the atom blocks.
 *
 * Plain elements with utility classes rather than the admin's shadcn components:
 * a package importing from an app inverts the dependency, and the components
 * would have to move into a shared package before they could be reused here.
 * Same result on screen, no cycle.
 *
 * Every control is a real labelled control, so the blocks are editable from the
 * keyboard like the rest of the document.
 */

const FRAME = 'my-2 rounded-md border p-3 text-sm'

function frame(selected: boolean, extra = ''): string {
  return `${FRAME} ${extra} ${selected ? 'ring-2 ring-blue-500' : ''}`.trim()
}

const INPUT = 'w-full rounded border border-neutral-300 px-2 py-1 text-sm'

export function ImageNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const mediaId = String(node.attrs.mediaId ?? '')

  return (
    <NodeViewWrapper className={frame(selected)} data-block="image">
      <div contentEditable={false} className="space-y-2">
        {mediaId === '' ? (
          <p className="text-neutral-500">No image chosen yet.</p>
        ) : (
          <p className="text-neutral-700">
            Image <code className="rounded bg-neutral-100 px-1">{mediaId}</code>
          </p>
        )}

        <label className="block text-xs text-neutral-500">
          Alt text
          <input
            className={`mt-1 ${INPUT}`}
            value={String(node.attrs.alt ?? '')}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateAttributes({ alt: event.target.value === '' ? null : event.target.value })
            }
          />
        </label>
      </div>
    </NodeViewWrapper>
  )
}

export function VideoNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const mediaId = String(node.attrs.mediaId ?? '')

  return (
    <NodeViewWrapper className={frame(selected)} data-block="video">
      <div contentEditable={false} className="space-y-2">
        {mediaId === '' ? (
          <p className="text-neutral-500">No video chosen yet.</p>
        ) : (
          <p className="text-neutral-700">
            Video <code className="rounded bg-neutral-100 px-1">{mediaId}</code>
          </p>
        )}

        <label className="block text-xs text-neutral-500">
          Title
          <input
            className={`mt-1 ${INPUT}`}
            value={String(node.attrs.title ?? '')}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              updateAttributes({ title: event.target.value === '' ? null : event.target.value })
            }
          />
        </label>
      </div>
    </NodeViewWrapper>
  )
}

export function CtaNodeView({ node, updateAttributes, selected }: NodeViewProps) {
  const set = (key: keyof CtaAttributes) => (event: ChangeEvent<HTMLInputElement>) =>
    updateAttributes({ [key]: event.target.value })

  return (
    <NodeViewWrapper className={frame(selected, 'bg-neutral-50')} data-block="cta">
      <div contentEditable={false} className="grid gap-2">
        <input
          className={INPUT}
          aria-label="Call to action title"
          placeholder="Title"
          value={String(node.attrs.title ?? '')}
          onChange={set('title')}
        />
        <input
          className={INPUT}
          aria-label="Call to action body"
          placeholder="Body"
          value={String(node.attrs.body ?? '')}
          onChange={set('body')}
        />
        <div className="flex gap-2">
          <input
            className={INPUT}
            aria-label="Button label"
            placeholder="Button label"
            value={String(node.attrs.label ?? '')}
            onChange={set('label')}
          />
          <input
            className={INPUT}
            aria-label="Button link"
            placeholder="/contact"
            value={String(node.attrs.href ?? '')}
            onChange={set('href')}
          />
        </div>
      </div>
    </NodeViewWrapper>
  )
}
