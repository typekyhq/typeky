import { defaultContext, type Repositories, type ThemeSummary, type ThemeTemplate } from '@typeky/db'
import { describe, expect, it } from 'vitest'
import { BASELINE_NAMES } from '@typeky/theme-default'
import {
  BUNDLED_THEME,
  isUploadableThemePath,
  listThemes,
  themeBaseline,
  themeTemplates,
} from './themes'

/**
 * Reading a theme out of the rows.
 *
 * The bundled theme is the one theme with no rows of its own, so every question here
 * has two answers: one for a theme that ships in code, one for a theme somebody
 * uploaded. What matters is that they are told apart by their *files* rather than by
 * a table -- a theme is its files, which is why there is no themes table.
 */

function row(overrides: Partial<ThemeTemplate> & { path: string }): ThemeTemplate {
  return {
    id: overrides.path,
    theme: 'uploaded',
    source: 'source',
    originalSource: 'source',
    revision: 1,
    updatedAt: new Date('2026-05-05T00:00:00.000Z'),
    ...overrides,
  }
}

function storeWith(rows: ThemeTemplate[]): Repositories {
  const byTheme = new Map<string, ThemeTemplate[]>()
  for (const entry of rows) {
    byTheme.set(entry.theme, [...(byTheme.get(entry.theme) ?? []), entry])
  }

  return {
    themeTemplates: {
      async list(_ctx: unknown, theme: string) {
        return byTheme.get(theme) ?? []
      },
      async byPath(_ctx: unknown, theme: string, path: string) {
        return (byTheme.get(theme) ?? []).find((entry) => entry.path === path) ?? null
      },
      async themes(): Promise<ThemeSummary[]> {
        return [...byTheme].map(([name, entries]) => ({
          name,
          files: entries.length,
          updatedAt: new Date('2026-05-05T00:00:00.000Z'),
        }))
      },
      async save() {
        throw new Error('not used')
      },
      async restore() {
        throw new Error('not used')
      },
      async removeTheme() {
        throw new Error('not used')
      },
    },
  } as unknown as Repositories
}

describe('the themes a deployment can serve', () => {
  it('includes the bundled theme, which has no rows', async () => {
    const listed = await listThemes(storeWith([]))

    expect(listed).toEqual([
      { name: BUNDLED_THEME, files: BASELINE_NAMES.length, updatedAt: null, bundled: true },
    ])
  })

  it('adds the uploaded ones, by name', async () => {
    const listed = await listThemes(
      storeWith([row({ path: 'templates/post' }), row({ theme: 'another', path: 'templates/page' })]),
    )

    expect(listed.map((entry) => entry.name)).toEqual([BUNDLED_THEME, 'another', 'uploaded'])
    expect(listed[1]?.bundled).toBe(false)
  })
})

describe('the templates of a theme', () => {
  it('are the baseline for the bundled one, edited or not', async () => {
    const templates = await themeTemplates(
      storeWith([row({ theme: BUNDLED_THEME, path: 'templates/post', source: 'mine', originalSource: null })]),
      BUNDLED_THEME,
    )

    expect(templates).toHaveLength(BASELINE_NAMES.length)
    const post = templates.find((entry) => entry.path === 'templates/post')
    expect(post?.source).toBe('mine')
    expect(post?.edited).toBe(true)
    // Everything else falls through to the bundled source, and is not an edit.
    expect(templates.find((entry) => entry.path === 'layouts/base')?.edited).toBe(false)
  })

  it('are what an uploaded theme shipped, with its assets left out', async () => {
    const templates = await themeTemplates(
      storeWith([
        row({ path: 'templates/post', source: 'edited', originalSource: 'original' }),
        row({ path: 'assets/theme.css', source: 'body{}', originalSource: 'body{}' }),
      ]),
      'uploaded',
    )

    expect(templates).toEqual([
      {
        path: 'templates/post',
        source: 'edited',
        edited: true,
        updatedAt: new Date('2026-05-05T00:00:00.000Z'),
      },
    ])
  })
})

describe('the baseline of a theme', () => {
  it('is the bundled theme for free', async () => {
    const baseline = await themeBaseline(storeWith([]), BUNDLED_THEME)

    expect(baseline).not.toBeNull()
    expect(Object.keys(baseline ?? {})).toHaveLength(BASELINE_NAMES.length)
  })

  it('is what an uploaded theme shipped, not what it says now', async () => {
    // The loader layers the site's edits over this, so answering with the edited
    // sources would make every file look edited and the undo forget its target.
    const baseline = await themeBaseline(
      storeWith([row({ path: 'templates/post', source: 'edited', originalSource: 'original' })]),
      'uploaded',
    )

    expect(baseline).toEqual({ 'templates/post': 'original' })
  })

  it('is nothing for a theme nobody installed', async () => {
    expect(await themeBaseline(storeWith([]), 'missing')).toBeNull()
  })
})

describe('the paths an upload may hold', () => {
  it('accepts a template name the renderer can reach', () => {
    expect(isUploadableThemePath('templates/post')).toBe(true)
    expect(isUploadableThemePath('snippets/header')).toBe(true)
    expect(isUploadableThemePath('layouts/base')).toBe(true)
    expect(isUploadableThemePath('assets/theme.css')).toBe(true)
  })

  it('refuses anything that would climb out or go nowhere', () => {
    // Traversal is the one that matters, but the others are refused for the same
    // reason: a file nothing can reach is a file nobody can remove either.
    expect(isUploadableThemePath('../secrets')).toBe(false)
    expect(isUploadableThemePath('templates/../../x')).toBe(false)
    expect(isUploadableThemePath('/etc/passwd')).toBe(false)
    expect(isUploadableThemePath('templates\\post')).toBe(false)
    expect(isUploadableThemePath('templates')).toBe(false)
    expect(isUploadableThemePath('assets/')).toBe(false)
    expect(isUploadableThemePath('other/thing')).toBe(false)
    // A template name with an extension is not a name the theme can ask for.
    expect(isUploadableThemePath('templates/post.liquid')).toBe(false)
  })
})
