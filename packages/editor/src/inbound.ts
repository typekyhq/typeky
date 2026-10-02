import type { Block } from '@typeky/core'
import type { Schema } from '@tiptap/pm/model'
import { DOMParser as ProseMirrorDOMParser } from '@tiptap/pm/model'
import { toBlockJSON } from './mapping'
import { cleanPastedHtml } from './paste'

/**
 * HTML back into blocks.
 *
 * The counterpart to `blockToHtml`, and how the round trip is checked. It parses
 * with the editor's own schema, which is the point: the same rules serve the
 * editor's clipboard and, later, the WordPress importer, so HTML that pastes
 * correctly also imports correctly (architecture section 3.11).
 *
 * This is the inbound direction, so it needs a DOM and only ever runs in the
 * admin. Nothing on the site side parses HTML.
 */
export function htmlToBlocks(html: string, schema: Schema): Block[] {
  if (html === '') return []

  const cleaned = cleanPastedHtml(html)
  const parsed = new DOMParser().parseFromString(`<body>${cleaned}</body>`, 'text/html')
  const document = ProseMirrorDOMParser.fromSchema(schema).parse(parsed.body)

  return toBlockJSON(document.toJSON())
}
