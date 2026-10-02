import { HEADING_LEVELS } from '@typeky/core'
import type { AnyExtension } from '@tiptap/core'
import { ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { BlockMovement } from './commands'
import { Cta } from './extensions/cta'
import { Image, Video } from './extensions/media'
import { CtaNodeView, ImageNodeView, VideoNodeView } from './node-views'
import { PasteCleanup } from './paste'
import { SlashMenu } from './slash-menu'

/**
 * The nine MVP block types (architecture section 3.11).
 *
 * Six come from StarterKit and three are ours:
 *
 *   paragraph          StarterKit
 *   heading            StarterKit, restricted to h2-h4
 *   list               StarterKit, bulleted and numbered
 *   quote              StarterKit blockquote
 *   code               StarterKit code block
 *   divider            StarterKit horizontal rule
 *   image              ours, holds a media id
 *   video              ours, holds a media id
 *   cta                ours, four data attributes
 *
 * `table`, `embed` and `productCard` are deliberately absent.
 *
 * The node definitions themselves are React-free; the NodeViews are attached
 * here so the extension modules stay usable without a renderer.
 */

/** Re-exported so callers do not have to reach into `@typeky/core` for it. */
export { HEADING_LEVELS }

export function createEditorExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      // Inline formats are bold, italic, link and code (section 3.11). Strike
      // and underline would survive in the document and then render as nothing,
      // which is worse than not offering them.
      strike: false,
      underline: false,
      // h1 belongs to the page title. One h1 per document, and it is not in the
      // body (section 3.8 renders the title from the entry, not from content).
      heading: { levels: [...HEADING_LEVELS] },
      link: { openOnClick: false, autolink: true },
    }),
    Image.extend({ addNodeView: () => ReactNodeViewRenderer(ImageNodeView) }),
    Video.extend({ addNodeView: () => ReactNodeViewRenderer(VideoNodeView) }),
    Cta.extend({ addNodeView: () => ReactNodeViewRenderer(CtaNodeView) }),
    // Block-level behaviour: pasted markup, moving a block, and the `/` menu.
    PasteCleanup,
    BlockMovement,
    SlashMenu,
  ]
}
