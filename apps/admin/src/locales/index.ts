import { en } from './en'

/**
 * The language files this panel has.
 *
 * The settings screen's language list is derived from this object, so a language
 * exists to the operator exactly when it exists as a file. That is the difference
 * between offering a translation and promising one.
 */
export const LOCALES: Record<string, Record<string, string>> = { en }

/** The one that is always there, and the one a missing key falls back to. */
export const DEFAULT_LOCALE = 'en'

/** For the settings screen: what to call each language in its own language. */
export const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
}

export interface LocaleOption {
  value: string
  /** The language's name in itself, which is what a speaker looks for. */
  label: string
}

export const LOCALE_OPTIONS: LocaleOption[] = Object.keys(LOCALES).map((value) => ({
  value,
  label: LOCALE_LABELS[value] ?? value,
}))
