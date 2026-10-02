import { RENDER_CONTEXT_KEYS } from '@typeky/core'
import { analyseTemplates } from '@typeky/theme-kit'
import { BASELINE } from '@typeky/theme-default'

/**
 * The templates only consume the RenderContext (red line 9), asserted in both
 * directions.
 *
 *   - A template using something the platform does not provide is a blank space
 *     on a page, and nobody finds out until a visitor sees it. This fails the
 *     build instead.
 *   - A context key no template uses is a promise the platform is not keeping. It
 *     also means the key list can only grow, which is how "the context" stops
 *     being something anyone can hold in their head.
 *
 * What a snippet may use is the context plus whatever its callers pass it, which
 * is the one rule that makes the two halves meet: a snippet is not a smaller
 * template, it is a function with arguments.
 *
 * Run with `pnpm check:context`.
 */

const CONTEXT_KEYS = new Set<string>(RENDER_CONTEXT_KEYS)

/** A template, not a fragment: nothing is passed to it, so it may only read. */
function isEntryPoint(name: string): boolean {
  return name.startsWith('templates/') || name.startsWith('layouts/')
}

async function main(): Promise<void> {
  const analysis = await analyseTemplates(BASELINE)
  const failures: string[] = []

  for (const { caller, callee } of analysis.unknownCallees) {
    failures.push(`${caller} renders "${callee}", which the theme does not ship`)
  }

  for (const dynamic of analysis.dynamicCallees) {
    failures.push(`${dynamic} — a render name must be a literal, or this cannot be checked`)
  }

  const used = new Set<string>()

  for (const [name, variables] of analysis.freeVariables) {
    // What this file may read: the context, plus its arguments when it is a
    // fragment rather than a template.
    const allowed = new Set(CONTEXT_KEYS)
    if (!isEntryPoint(name)) {
      for (const argument of analysis.passedTo.get(name) ?? []) allowed.add(argument)
    }

    for (const variable of variables) {
      used.add(variable)

      if (!allowed.has(variable)) {
        const why = isEntryPoint(name)
          ? 'a template may only read the render context'
          : `not a context key, and no caller passes it (callers pass: ${
              [...(analysis.passedTo.get(name) ?? [])].join(', ') || 'nothing'
            })`
        failures.push(`${name} uses "${variable}" — ${why}`)
      }
    }
  }

  for (const key of RENDER_CONTEXT_KEYS) {
    if (!used.has(key)) {
      failures.push(`the render context declares "${key}", which no template uses`)
    }
  }

  if (failures.length > 0) {
    console.error('\nThe templates and the render context disagree:\n')
    for (const failure of failures) console.error(`  x ${failure}`)
    console.error('')
    process.exit(1)
  }

  const templates = analysis.freeVariables.size
  const fragments = [...analysis.freeVariables.keys()].filter((name) => !isEntryPoint(name)).length
  console.log(
    `check:context -- passed (${String(templates)} templates, ${String(fragments)} fragments, ${String(
      CONTEXT_KEYS.size,
    )} context keys: ${RENDER_CONTEXT_KEYS.join(', ')})`,
  )
}

await main()
