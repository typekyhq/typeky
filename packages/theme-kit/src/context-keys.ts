import { Liquid } from 'liquidjs'

/**
 * What variables a set of templates needs from whoever renders them.
 *
 * Liquid is weakly typed: a misspelt variable is not a compile error, it is a
 * blank space on a page. This is the compensation the architecture asks for --
 * the free variables of every template, collected so CI can compare them with the
 * context the platform actually provides.
 *
 * Three things about liquidjs's own analysis shape how this works, all measured
 * rather than assumed:
 *
 *   - It resolves `{% render %}` eagerly even with no filesystem, and fails with
 *     ENOENT. So the tags are removed before parsing; the callee and its
 *     arguments are read from the source instead, which is where they are
 *     readable anyway -- liquidjs keeps them in private fields.
 *   - When it *can* resolve them, it reports the partial's free variables
 *     *including* the ones passed in, so a snippet's parameters look like
 *     globals. The union over everything is therefore not the answer.
 *   - `{% layout %}` resolves eagerly too, and the loader here is asynchronous by
 *     design. The layout is analysed by itself anyway: it is in the baseline and
 *     gets its own entry.
 *
 * The one semantic this has to get right is the difference between the two
 * inclusion tags: `render` gives the fragment a scope of its own, so its free
 * variables are its parameters, while `include` shares the caller's, so the
 * included file's free variables become the caller's. Both are handled.
 */

export interface TemplateAnalysis {
  /** Free variables per template name: what the file needs from outside. */
  freeVariables: Map<string, string[]>
  /** Argument names passed to each callee, by every caller that renders it. */
  passedTo: Map<string, Set<string>>
  /** A callee named by a template but absent from the baseline. */
  unknownCallees: { caller: string; callee: string }[]
  /** A call whose name is not a literal, which cannot be checked. */
  dynamicCallees: string[]
}

const CALL = /\{%-?\s*(render|include)\s+([^%]*?)\s*-?%\}/g
const LAYOUT_TAG = /\{%-?\s*layout\s+[^%]*?-?%\}/g
const LITERAL_NAME = /^['"]([^'"]+)['"]/
const ARGUMENT_NAME = /(?:^|[,\s])([A-Za-z_][A-Za-z0-9_]*)\s*:/g
const ARGUMENT_VALUE = /[A-Za-z_][A-Za-z0-9_]*\s*:\s*([A-Za-z_][A-Za-z0-9_.]*)/g

export async function analyseTemplates(baseline: Record<string, string>): Promise<TemplateAnalysis> {
  const engine = new Liquid() as unknown as {
    parse(source: string): unknown
    globalVariables(parsed: unknown): Promise<string[]>
  }

  const freeVariables = new Map<string, string[]>()
  const passedTo = new Map<string, Set<string>>()
  const includedBy = new Map<string, string[]>()
  const unknownCallees: TemplateAnalysis['unknownCallees'] = []
  const dynamicCallees: string[] = []

  for (const [name, source] of Object.entries(baseline)) {
    const used = new Set(await engine.globalVariables(engine.parse(stripCalls(source))))

    for (const call of source.matchAll(CALL)) {
      const kind = call[1] as 'render' | 'include'
      const argument = (call[2] ?? '').trim()

      const callee = LITERAL_NAME.exec(argument)?.[1]
      if (callee === undefined) {
        dynamicCallees.push(`${name}: {% ${kind} ${argument.slice(0, 40)} %}`)
        continue
      }

      const key = callee.replace(/^\.?\//, '').replace(/\.liquid$/, '')
      if (!Object.hasOwn(baseline, key)) {
        unknownCallees.push({ caller: name, callee })
        continue
      }

      if (kind === 'include') {
        // `include` shares the caller's scope, so the included file's free
        // variables are the caller's too. Recorded here, folded in below.
        includedBy.set(name, [...(includedBy.get(name) ?? []), key])
        continue
      }

      const args = passedTo.get(key) ?? new Set<string>()
      for (const match of argument.matchAll(ARGUMENT_NAME)) {
        if (match[1] !== undefined) args.add(match[1])
      }
      passedTo.set(key, args)
    }

    freeVariables.set(name, [...used].sort())
  }

  // Fold in what `include` shares. A visited set, because a file may include
  // itself indirectly and the analysis should end rather than recurse.
  for (const [name, includes] of includedBy) {
    const merged = new Set(freeVariables.get(name) ?? [])
    const visited = new Set<string>([name])
    const queue = [...includes]

    while (queue.length > 0) {
      const next = queue.pop()!
      if (visited.has(next)) continue
      visited.add(next)
      for (const variable of freeVariables.get(next) ?? []) merged.add(variable)
      queue.push(...(includedBy.get(next) ?? []))
    }

    freeVariables.set(name, [...merged].sort())
  }

  return { freeVariables, passedTo, unknownCallees, dynamicCallees }
}

/**
 * Every tag that resolves a file, replaced before parsing.
 *
 * Not because they are unimportant -- their names and arguments are read from the
 * source, above -- but because liquidjs resolves them eagerly and there is no
 * filesystem here by design.
 *
 * The arguments are kept, as expressions rather than as a list of names: whether
 * a value is a variable this file must provide is a question about scope, and the
 * parser is the thing that knows. `{% for post in content %}{% render 'snippets/post-card', post: post %}`
 * becomes `{% for post in content %}{{ post }}`, whose only free variable is
 * `content` -- which a list of names would have got wrong.
 */
function stripCalls(source: string): string {
  return source
    .replace(LAYOUT_TAG, '')
    .replace(CALL, (_match, _kind, argument: string) => {
      return [...argument.matchAll(ARGUMENT_VALUE)].map((match) => `{{ ${match[1] ?? ''} }}`).join('')
    })
}
