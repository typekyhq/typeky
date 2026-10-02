import type { DbPort } from '@typeky/platform'
import type { Repositories } from '../../contracts'
import { createMediaRepository } from './media'
import { createPageRepository } from './pages'
import { createPostRepository } from './posts'
import { createProductRepository } from './products'
import { createSiteRepository } from './sites'
import { createThemeTemplateRepository } from './theme-templates'

/**
 * Builds the SQLite repository set over an injected database port.
 *
 * The SQL below this point is SQLite dialect, which is why the folder is named
 * after D1. The port is what makes the same repositories testable against an
 * in-memory engine and swappable for PostgreSQL later (architecture section 5.3).
 */
export function createD1Repositories(db: DbPort): Repositories {
  return {
    sites: createSiteRepository(db),
    pages: createPageRepository(db),
    posts: createPostRepository(db),
    products: createProductRepository(db),
    media: createMediaRepository(db),
    themeTemplates: createThemeTemplateRepository(db),
  }
}
