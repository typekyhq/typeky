import { useMemo } from 'react'
import { DEFAULT_LOCALE, LOCALES } from '@/locales'
import { usePanelPreference } from './panel-preference'

/**
 * The panel's words, in the language the operator chose.
 *
 * It reads the same preference the dates come from rather than having a provider
 * of its own: the language is one setting, and two places to read it is two
 * places to disagree about it.
 *
 * The fallback chain is deliberate. A key missing from the chosen language falls
 * back to English rather than showing the raw key, because a half-finished
 * translation should be a panel with a few English words in it rather than a
 * panel full of `settings.footer`. Only a key missing everywhere shows itself,
 * which is the same choice the theme's `t` filter makes.
 *
 * Plurals are the one piece of grammar here, and they are as small as they can
 * be: when `vars.count` is a number, `key.one` is used for one and `key.other`
 * for anything else. That is the whole of English's rule. A language with more
 * forms needs more, and that is a change to make when such a language arrives
 * rather than a guess to make now.
 */

export type Translate = (key: string, vars?: Record<string, string | number>) => string

export function createTranslator(language: string): Translate {
  const table = LOCALES[language] ?? {}
  const fallback = LOCALES[DEFAULT_LOCALE] ?? {}

  return (key, vars) => {
    const counted =
      typeof vars?.count === 'number' ? `${key}.${vars.count === 1 ? 'one' : 'other'}` : undefined

    const template =
      (counted === undefined ? undefined : (table[counted] ?? fallback[counted])) ??
      table[key] ??
      fallback[key] ??
      key
    if (vars === undefined) return template

    return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
      // A placeholder with no value is left alone: it should be as visible as a
      // missing key, because both mean the same thing -- somebody has to look.
      name in vars ? String(vars[name]) : whole,
    )
  }
}

export function useT(): Translate {
  const { language } = usePanelPreference()

  return useMemo(() => createTranslator(language), [language])
}
