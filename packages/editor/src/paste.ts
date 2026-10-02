import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

/**
 * Rewrites pasted HTML before the editor parses it.
 *
 * Most of what "sanitising" usually means is already structural and needs nothing
 * here, because the parser can only produce nodes the schema knows: unknown tags
 * become their text, `<script>` and `<style>` are ignored entirely, style
 * attributes are dropped, an `<h1>` becomes a paragraph, and the link extension
 * refuses a `javascript:` href on the way in. None of the source markup is ever
 * stored -- the editor writes Block JSON, and there is no path from an arbitrary
 * tag to stored content.
 *
 * Two things do need doing, and both were found by testing rather than assumed.
 */

/**
 * Zero-width spaces and soft hyphens.
 *
 * Word and web pages sprinkle these through text to mark spell-check boundaries.
 * They are invisible, they survive parsing, and they end up in stored content
 * where they defeat search and comparison.
 */
const INVISIBLE = /[\u200b\u00ad]/g

/** Reads as a row of a table when a table cannot be represented. */
const CELL_SEPARATOR = ' | '

export function cleanPastedHtml(html: string): string {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

  flattenTables(parsed)

  return parsed.body.innerHTML.replace(INVISIBLE, '')
}

/**
 * Turns a table into one paragraph per row.
 *
 * The block model has no table -- it is deliberately not one of the nine -- so a
 * pasted table has to become text. Left to the parser, the cells run together
 * into `H1H2ABCD`, which loses the row structure a reader needs; a separator
 * keeps it legible, and a paragraph per row keeps the rows apart.
 */
function flattenTables(document: Document): void {
  for (const table of Array.from(document.querySelectorAll('table'))) {
    const replacement = document.createDocumentFragment()

    for (const row of Array.from(table.querySelectorAll('tr'))) {
      const cells = Array.from(row.querySelectorAll('th, td'))
        .map((cell) => (cell.textContent ?? '').trim())
        .filter((text) => text !== '')

      if (cells.length === 0) continue

      const paragraph = document.createElement('p')
      paragraph.textContent = cells.join(CELL_SEPARATOR)
      replacement.appendChild(paragraph)
    }

    table.replaceWith(replacement)
  }
}

/**
 * The cleaning, as part of the schema rather than as an editor option.
 *
 * `transformPastedHTML` is an editor prop, so putting it there would mean every
 * place that constructs an editor has to remember it -- and the one that forgets
 * is the one nobody tests. A plugin travels with the extensions, so anything
 * built from `createEditorExtensions()` cleans its paste.
 */
export const PasteCleanup = Extension.create({
  name: 'pasteCleanup',

  addProseMirrorPlugins() {
    return [new Plugin({ props: { transformPastedHTML: cleanPastedHtml } })]
  },
})
