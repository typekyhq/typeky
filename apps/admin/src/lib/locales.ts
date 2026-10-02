/**
 * The languages this panel can be read in, and the tags a site can claim.
 *
 * Two different lists, which is why they are separate:
 *
 *   - `ADMIN_LOCALES` is what the panel has **translations** for. Today that is
 *     English only, and the list is the honest place to say so: adding a language
 *     is adding a file next to this one, and it appears here the moment it
 *     exists. A panel that offered a language it could not render would be a
 *     promise the code does not keep.
 *   - `LANGUAGE_TAGS` is what a **site** may be written in. It is a claim about
 *     the content, not about this panel, so it is a suggestion list rather than a
 *     closed set -- a site in a language nobody here speaks is a normal thing.
 */

export interface AdminLocale {
  value: string
  label: string
}

export const ADMIN_LOCALES: AdminLocale[] = [{ value: 'en', label: 'English' }]

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
