import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_LOCALE, LOCALES } from '@/locales'
import { createTranslator } from './i18n'

/**
 * The locale file against the code that reads it.
 *
 * A missing key does not crash: it shows the key itself, which is the right
 * behaviour for a person looking at a screen and the wrong behaviour for a test
 * suite. So the keys the panel asks for are collected from the source and checked
 * here, because "I added a string and forgot the file" is the one mistake this
 * whole arrangement makes easy.
 *
 * Keys built at runtime -- `media.kind.post`, `licence.problem.bad_signature` --
 * cannot be read out of a literal, so the prefix is collected instead and the
 * file is asked whether it has a family under it.
 */

const SRC = new URL('../', import.meta.url).pathname

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = join(directory, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    if (!/\.tsx?$/.test(entry) || /\.test\./.test(entry)) return []

    return [full]
  })
}

interface Usage {
  /** Keys written out in full. */
  literal: string[]
  /** Prefixes of keys assembled from a template literal. */
  dynamic: string[]
}

function collectUsages(): Usage {
  const literal = new Set<string>()
  const dynamic = new Set<string>()

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8')

    for (const match of source.matchAll(/\bt\(\s*'([^']+)'/g)) literal.add(match[1] ?? '')
    for (const match of source.matchAll(/\bt\(\s*`([^`$]*)\$\{/g)) dynamic.add(match[1] ?? '')
  }

  return { literal: [...literal].sort(), dynamic: [...dynamic].sort() }
}

describe('the keys the panel asks for', () => {
  const en = LOCALES[DEFAULT_LOCALE] ?? {}
  const { literal, dynamic } = collectUsages()

  it('all exist in the default language', () => {
    // A key used with a count is satisfied by its two forms rather than by
    // itself: `list.bulkResult` is never looked up, `list.bulkResult.one` is.
    const present = (key: string): boolean =>
      en[key] !== undefined || (en[`${key}.one`] !== undefined && en[`${key}.other`] !== undefined)

    // Reported as a list rather than one at a time: adding a screen with three
    // new strings should not take three test runs to find out about.
    const missing = literal.filter((key) => !present(key))

    expect(missing).toEqual([])
  })

  it('have a family for the ones built at runtime', () => {
    const orphans = dynamic.filter((prefix) => !Object.keys(en).some((key) => key.startsWith(prefix)))

    expect(orphans).toEqual([])
  })

  it('were found at all, which is what makes the two checks above mean anything', () => {
    // A rename of `t` or a change to how it is called would silently empty both
    // lists; this is the assertion that notices.
    expect(literal.length).toBeGreaterThan(100)
    expect(dynamic.length).toBeGreaterThan(0)
  })
})

describe('every language file', () => {
  const english = LOCALES[DEFAULT_LOCALE] ?? {}

  it.each(Object.keys(LOCALES))('%s has exactly the default key set', (language) => {
    const keys = Object.keys(LOCALES[language] ?? {})

    // Both directions, because the two failures are different. A key only one
    // language has is usually a typo; a key one language is *missing* falls back
    // to English at runtime, which is right for a language somebody is still
    // working on and wrong for one that ships. A shipped file is complete, and
    // the fallback exists so an unfinished one works rather than so one can be
    // published.
    expect([...keys].sort()).toEqual(Object.keys(english).sort())
  })

  it.each(Object.keys(LOCALES))('%s keeps every placeholder the default uses', (language) => {
    // The failure this catches is a translation that reads well and quietly drops
    // a value: `{count}` missing from one sentence is a sentence that no longer
    // says how many, and nothing else would notice.
    const table = LOCALES[language] ?? {}

    const wrong = Object.keys(english).filter((key) => {
      const placeholders = (value: string | undefined): string[] =>
        [...(value ?? '').matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort()

      return placeholders(table[key]).join(',') !== placeholders(english[key]).join(',')
    })

    expect(wrong).toEqual([])
  })

  it('are actually written, which is what makes the checks above mean something', () => {
    expect(Object.keys(LOCALES).length).toBeGreaterThan(1)
    expect(Object.keys(english).length).toBeGreaterThan(100)
  })
})

describe('the translator', () => {
  it('renders a missing key as itself, so it shows up instead of vanishing', () => {
    expect(createTranslator('en')('nope.not.here')).toBe('nope.not.here')
  })

  it('fills in the values it is given', () => {
    expect(createTranslator('en')('list.select', { label: 'Hello' })).toBe('Select Hello')
  })

  it('leaves a placeholder alone when there is no value for it', () => {
    expect(createTranslator('en')('list.select')).toBe('Select {label}')
  })

  it('picks the plural form from `count`', () => {
    const t = createTranslator('en')

    expect(t('list.bulkResult', { count: 1 })).toBe('1 item updated.')
    expect(t('list.bulkResult', { count: 3 })).toBe('3 items updated.')
  })

  it('falls back to the default language rather than to the key', () => {
    // A half-finished translation should be a panel with a few foreign words in
    // it, not a panel full of `settings.footer`.
    const partial = { ...LOCALES, xx: { 'nav.brand': 'Merki' } }
    const original = LOCALES.xx
    LOCALES.xx = partial.xx

    try {
      const t = createTranslator('xx')

      expect(t('nav.brand')).toBe('Merki')
      expect(t('nav.settings')).toBe('Settings')
    } finally {
      delete LOCALES.xx
      void original
    }
  })

  it('falls back to the default for a language that does not exist at all', () => {
    expect(createTranslator('qq')('nav.brand')).toBe('Typeky')
  })
})
