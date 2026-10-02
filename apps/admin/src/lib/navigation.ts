/**
 * The sections of the admin panel.
 *
 * One list, used by the sidebar, the breadcrumbs and the router, so a section
 * cannot appear in one place and be missing from another. The labels are keys
 * rather than words: a module of data has no way to reach the translator, and a
 * label built here would be the one string a translator could not find.
 */

export interface NavigationItem {
  to: string
  /** A key into the locale file, not a word: this module holds no English. */
  labelKey: string
  /** Exact match only; needed for the index route. */
  end?: boolean
  /** What the section will do, shown on its placeholder page. */
  descriptionKey: string
}

export const NAVIGATION: NavigationItem[] = [
  {
      to: '/',
      labelKey: 'nav.dashboard',
      end: true,
      descriptionKey: 'nav.dashboard.description',
    },
  {
      to: '/pages',
      labelKey: 'nav.pages',
      descriptionKey: 'nav.pages.description',
    },
  {
      to: '/posts',
      labelKey: 'nav.posts',
      descriptionKey: 'nav.posts.description',
    },
  {
      to: '/products',
      labelKey: 'nav.products',
      descriptionKey: 'nav.products.description',
    },
  {
      to: '/media',
      labelKey: 'nav.media',
      descriptionKey: 'nav.media.description',
    },
  {
      to: '/theme',
      labelKey: 'nav.theme',
      descriptionKey: 'nav.theme.description',
    },
  {
      to: '/settings',
      labelKey: 'nav.settings',
      descriptionKey: 'nav.settings.description',
    },
]
