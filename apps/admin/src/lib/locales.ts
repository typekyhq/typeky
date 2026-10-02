/**
 * The languages this panel can be read in, and the tags a site can claim.
 *
 * Two different lists, which is why they are separate:
 *
 *   - the panel's languages come from **the language files that exist**
 *     (`@/locales`), so the settings screen cannot offer a translation the panel
 *     does not have. Adding one is adding a file.
 *   - `LANGUAGE_TAGS` is what a **site** may be written in. That is a claim about
 *     the content rather than about this panel, so it is a suggestion list and not
 *     a closed set -- a site in a language nobody here speaks is a normal thing.
 */

export { LOCALE_OPTIONS as ADMIN_LOCALES, type LocaleOption as AdminLocale } from '@/locales'

/** Common BCP 47 tags, offered as a datalist and not as a limit. */
export const LANGUAGE_TAGS = [
  'en',
  'zh-CN',
  'zh-TW',
  'ja',
  'ko',
  'de',
  'fr',
  'es',
  'pt-BR',
  'it',
  'nl',
  'ru',
  'ar',
]
