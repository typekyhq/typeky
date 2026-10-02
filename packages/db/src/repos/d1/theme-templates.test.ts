import { describe, expect, it } from 'vitest'
import { defaultContext } from '../../contracts'
import { createD1Repositories } from '.'
import { createTestDatabase } from '../testing'

function setup() {
  const db = createTestDatabase()
  return { db, themeTemplates: createD1Repositories(db).themeTemplates }
}

const ctx = defaultContext()

describe('theme template repository', () => {
  it('starts empty, so every template falls through to the bundled baseline', async () => {
    const { themeTemplates } = setup()

    expect(await themeTemplates.list(ctx, 'default')).toEqual([])
    expect(await themeTemplates.byPath(ctx, 'default', 'templates/post')).toBeNull()
  })

  it('creates an override and defaults its theme to default', async () => {
    const { themeTemplates } = setup()

    const saved = await themeTemplates.save(ctx, { path: 'templates/post', source: '<h1>{{ post.title }}</h1>' })

    expect(saved.theme).toBe('default')
    expect(saved.path).toBe('templates/post')
    expect(saved.revision).toBe(1)
    expect(saved.updatedAt).toBeInstanceOf(Date)
  })

  it('replaces the override in place and bumps its revision', async () => {
    const db = createTestDatabase()
    const { themeTemplates } = createD1Repositories(db)

    const first = await themeTemplates.save(ctx, { path: 'templates/post', source: 'a' })
    const second = await themeTemplates.save(ctx, { path: 'templates/post', source: 'b' })

    expect(second.id).toBe(first.id)
    expect(second.source).toBe('b')
    expect(second.revision).toBe(2)

    const count = await db.first<{ total: number }>('SELECT count(*) AS total FROM theme_templates')
    expect(count?.total).toBe(1)
  })

  it('scopes overrides by theme, so the same path can differ per theme', async () => {
    const { themeTemplates } = setup()

    await themeTemplates.save(ctx, { theme: 'default', path: 'templates/post', source: 'default source' })
    await themeTemplates.save(ctx, { theme: 'minimal', path: 'templates/post', source: 'minimal source' })

    expect((await themeTemplates.byPath(ctx, 'default', 'templates/post'))?.source).toBe('default source')
    expect((await themeTemplates.byPath(ctx, 'minimal', 'templates/post'))?.source).toBe('minimal source')
    expect(await themeTemplates.list(ctx, 'default')).toHaveLength(1)
  })

  it('lists a theme ordered by path', async () => {
    const { themeTemplates } = setup()
    await themeTemplates.save(ctx, { path: 'templates/post', source: 'a' })
    await themeTemplates.save(ctx, { path: 'layouts/base', source: 'b' })
    await themeTemplates.save(ctx, { path: 'snippets/header', source: 'c' })

    const listed = await themeTemplates.list(ctx, 'default')

    expect(listed.map((template) => template.path)).toEqual([
      'layouts/base',
      'snippets/header',
      'templates/post',
    ])
  })

  it('resets by dropping the override, which restores the baseline', async () => {
    const { themeTemplates } = setup()
    await themeTemplates.save(ctx, { path: 'templates/post', source: 'custom' })

    expect(await themeTemplates.reset(ctx, 'default', 'templates/post')).toBe(true)
    expect(await themeTemplates.byPath(ctx, 'default', 'templates/post')).toBeNull()
    expect(await themeTemplates.reset(ctx, 'default', 'templates/post')).toBe(false)
  })

  it('does not reset a different theme on the same path', async () => {
    const { themeTemplates } = setup()
    await themeTemplates.save(ctx, { theme: 'minimal', path: 'templates/post', source: 'custom' })

    expect(await themeTemplates.reset(ctx, 'default', 'templates/post')).toBe(false)
    expect(await themeTemplates.byPath(ctx, 'minimal', 'templates/post')).not.toBeNull()
  })
})
