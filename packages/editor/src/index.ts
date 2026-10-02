/**
 * @typeky/editor -- The block editor: Tiptap schema, block definitions and the
 * React component the admin mounts
 *
 * Layout and responsibilities: CONTRIBUTING.md section 6
 * Architecture red lines: CONTRIBUTING.md section 3
 *
 * This package is React-based and may only be imported by the admin SPA. The site
 * Worker must never reach it -- `pnpm check:boundaries` fails the build if it
 * does (section 3.11). Nothing here produces stored content or HTML: the mapping
 * layer turns ProseMirror JSON into Block JSON, and `@typeky/core`'s
 * `blockToHtml` is the only thing that produces markup.
 */

export { BlockEditor, type BlockEditorProps } from './block-editor'
export { createEditorExtensions, HEADING_LEVELS } from './schema'
export { fromBlockJSON, toBlockJSON } from './mapping'
export { BLOCK_ACTIONS, EditorToolbar } from './toolbar'
export { Cta, type CtaAttributes } from './extensions/cta'
export { Image, type ImageAttributes, Video, type VideoAttributes } from './extensions/media'
