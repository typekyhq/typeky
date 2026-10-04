import { ar } from './ar'
import { en, type Locale } from './en'
import { es } from './es'
import { fr } from './fr'
import { ja } from './ja'
import { ko } from './ko'
import { ptBR } from './pt-BR'
import { ru } from './ru'
import { zhCN } from './zh-CN'

export type { Locale } from './en'

/**
 * The language files this panel has.
 *
 * The settings screen's language list is derived from this object, so a language
 * exists to the operator exactly when it exists as a file. That is the difference
 * between offering a translation and promising one.
 */
export const LOCALES: Record<string, Locale> = { ar, en, es, fr, ja, ko, 'pt-BR': ptBR, ru, 'zh-CN': zhCN }

/** The one that is always there, and the one a missing key falls back to. */
export const DEFAULT_LOCALE = 'en'

/**
 * For the settings screen: what to call each language.
 *
 * Each in its own language, because that is what a speaker looks for in a list --
 * and English is named in English for the same reason.
 */
export const LOCALE_LABELS: Record<string, string> = {
  ar: 'العربية',
  en: 'English',
  es: 'Español',
  fr: 'Français',
  ja: '日本語',
  ko: '한국어',
  'pt-BR': 'Português (Brasil)',
  ru: 'Русский',
  'zh-CN': '简体中文',
}

export interface LocaleOption {
  value: string
  /** The language's name in itself. */
  label: string
}

export const LOCALE_OPTIONS: LocaleOption[] = Object.keys(LOCALES).map((value) => ({
  value,
  label: LOCALE_LABELS[value] ?? value,
}))
