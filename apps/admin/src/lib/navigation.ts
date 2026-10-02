/**
 * The sections of the admin panel.
 *
 * One list, used by the sidebar, the breadcrumbs and the router, so a section
 * cannot appear in one place and be missing from another.
 */

export interface NavigationItem {
  to: string
  label: string
  /** Exact match only; needed for the index route. */
  end?: boolean
  /** What the section will do, shown on its placeholder page. */
  description: string
}

export const NAVIGATION: NavigationItem[] = [
  {
    to: '/',
    label: 'Dashboard',
    end: true,
    description: 'An overview of the site: recent content, drafts and the last publish.',
  },
  {
    to: '/pages',
    label: 'Pages',
    description: 'Standalone pages, including the one marked as the home page.',
  },
  {
    to: '/posts',
    label: 'Posts',
    description: 'Blog posts, with drafts, tags and a category.',
  },
  {
    to: '/products',
    label: 'Products',
    description: 'Showcase products: gallery, specs, a price label and an outbound link.',
  },
  {
    to: '/media',
    label: 'Media',
    description: 'Images and other uploads, stored in R2 and referenced by content.',
  },
  {
    to: '/theme',
    label: 'Theme',
    description: 'Edit the Liquid templates online; changes go live as soon as they are saved.',
  },
  {
    to: '/settings',
    label: 'Settings',
    description: 'Site name, tagline, logo, accent colour, navigation and SEO defaults.',
  },
]
