import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { html } from '@codemirror/lang-html'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorState, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  drawSelection,
  keymap,
  lineNumbers,
  tooltips,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view'

/**
 * The template editor.
 *
 * CodeMirror rather than a textarea with a highlighted layer, which is a choice
 * about what a theme author gets: line numbers, bracket and quote pairing, a
 * real undo stack, and a viewport that stays in step without anyone writing
 * scroll synchronisation by hand.
 *
 * Two languages, because a template is two languages. HTML is a language
 * package. Liquid is a decorator over the text, matching `{{ }}` and `{% %}` --
 * CodeMirror has no Liquid grammar, and pretending otherwise by highlighting the
 * HTML and calling it done is how `{% if %}` ends up looking like prose.
 *
 * Loaded lazily: CodeMirror is around 160 KB gzipped, which is most of what the
 * block editor costs, and a screen that edits templates should not be paid for
 * by a screen that edits posts. `pnpm check:boundaries` fails if it reaches the
 * first screen.
 */

const setErrorLine = StateEffect.define<number | null>()

/** The line to mark, if any. Theme authors spend their time here after a failure. */
const errorLine = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(decorations, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setErrorLine)) {
        const line = effect.value
        if (line === null) return Decoration.none

        const target = transaction.state.doc.line(Math.min(line, transaction.state.doc.lines))
        return Decoration.set([Decoration.line({ class: 'cm-errorLine' }).range(target.from)])
      }
    }

    return decorations.map(transaction.changes)
  },
  provide: (field) => EditorView.decorations.from(field),
})

/**
 * `{{ output }}` and `{% tag %}`, plus Liquid comments.
 *
 * A decorator rather than a grammar: it marks the ranges, and the styling lives
 * in the theme below. Ranges are found per viewport, so a very long template
 * costs nothing for the part nobody is looking at.
 */
const liquid = new MatchDecorator({
  regexp: /\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|\{#[\s\S]*?#\}/g,
  decoration: (match) =>
    Decoration.mark({
      class: match[0]!.startsWith('{{') ? 'cm-liquidOutput' : match[0]!.startsWith('{#') ? 'cm-liquidComment' : 'cm-liquidTag',
    }),
})

const liquidHighlight = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = liquid.createDeco(view)
    }

    update(update: ViewUpdate): void {
      // `updateDeco` re-matches only what the viewport needs, which is what
      // keeps a long template from being scanned on every keystroke.
      this.decorations = liquid.updateDeco(update, this.decorations)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

const theme = EditorView.theme({
  '&': { fontSize: '13px', border: '1px solid var(--color-border, #d4d4d8)', borderRadius: '6px' },
  '.cm-content': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: '#fafafa', borderRight: '1px solid #e4e4e7', color: '#71717a' },
  '.cm-errorLine': { backgroundColor: '#fee2e2' },
  '.cm-liquidTag': { color: '#7c3aed' },
  '.cm-liquidOutput': { color: '#0f766e' },
  '.cm-liquidComment': { color: '#a1a1aa', fontStyle: 'italic' },
})

export interface TemplateEditorProps {
  /** The source to open. Only read on mount; pass a key to reopen a different file. */
  initialSource: string
  onChange: (source: string) => void
  /** 1-based line to mark as the problem, or null. */
  errorLine?: number | null
  /** Focus the editor on mount. */
  autoFocus?: boolean
}

export class TemplateEditor {
  private readonly view: EditorView

  constructor(parent: HTMLElement, props: TemplateEditorProps) {
    const state = EditorState.create({
      doc: props.initialSource,
      extensions: [
        lineNumbers(),
        drawSelection(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        syntaxHighlighting(defaultHighlightStyle),
        html(),
        errorLine,
        liquidHighlight,
        theme,
        // The tooltip container has to be the editor's own element, or the
        // suggestions a keymap offers land outside the scrollable area.
        tooltips({ parent: parent }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) props.onChange(update.state.doc.toString())
        }),
      ],
    })

    this.view = new EditorView({ parent, state })

    if (props.errorLine !== undefined && props.errorLine !== null) this.markError(props.errorLine)
    if (props.autoFocus === true) this.view.focus()
  }

  /** Moves the marked line, and brings it into view. */
  markError(line: number | null): void {
    this.view.dispatch({ effects: setErrorLine.of(line) })

    if (line !== null) {
      const target = this.view.state.doc.line(Math.min(line, this.view.state.doc.lines))
      this.view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: 'center' }) })
    }
  }

  get value(): string {
    return this.view.state.doc.toString()
  }

  destroy(): void {
    this.view.destroy()
  }
}
