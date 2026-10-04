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

  it('restores a bundled template by dropping the override', async () => {
    const { themeTemplates } = setup()
    await themeTemplates.save(ctx, { path: 'templates/post', source: 'custom' })

    expect(await themeTemplates.restore(ctx, 'default', 'templates/post')).toBe(true)
    expect(await themeTemplates.byPath(ctx, 'default', 'templates/post')).toBeNull()
    expect(await themeTemplates.restore(ctx, 'default', 'templates/post')).toBe(false)
  })

  it('does not restore a different theme on the same path', async () => {
    const { themeTemplates } = setup()
    await themeTemplates.save(ctx, { theme: 'minimal', path: 'templates/post', source: 'custom' })

    expect(await themeTemplates.restore(ctx, 'default', 'templates/post')).toBe(false)
    expect(await themeTemplates.byPath(ctx, 'minimal', 'templates/post')).not.toBeNull()
  })

  it('restores an uploaded theme file in place, keeping the file', async () => {
    // Two shapes of undo, and this is the one an uploaded theme needs: dropping the
    // row would take the file out of the theme, because for an uploaded theme the
    // row *is* the file.
    const { themeTemplates } = setup()
    await themeTemplates.save(ctx, {
      theme: 'uploaded',
      path: 'templates/post',
      source: 'original',
      originalSource: 'original',
    })
    await themeTemplates.save(ctx, { theme: 'uploaded', path: 'templates/post', source: 'edited' })

    expect((await themeTemplates.byPath(ctx, 'uploaded', 'templates/post'))?.source).toBe('edited')
    expect(await themeTemplates.restore(ctx, 'uploaded', 'templates/post')).toBe(true)

    const restored = await themeTemplates.byPath(ctx, 'uploaded', 'templates/post')
    expect(restored?.source).toBe('original')
    expect(restored?.originalSource).toBe('original')
  })

  it('keeps the uploaded original through an edit', async () => {
    // The undo depends on the difference, so an edit must not overwrite it.
    const { themeTemplates } = setup()
    await themeTemplates.save(ctx, { theme: 'uploaded', path: 'templates/post', source: 'v1', originalSource: 'v1' })
    const edited = await themeTemplates.save(ctx, { theme: 'uploaded', path: 'templates/post', source: 'v2' })

    expect(edited.originalSource).toBe('v1')
  })

  it('counts the themes that exist', async () => {
    const { themeTemplates } = setup()
    await themeTemplates.save(ctx, { path: 'templates/post', source: 'a' })
    await themeTemplates.save(ctx, { theme: 'uploaded', path: 'templates/post', source: 'b' })
    await themeTemplates.save(ctx, { theme: 'uploaded', path: 'layouts/base', source: 'c' })

    expect(await themeTemplates.themes(ctx)).toMatchObject([
      { name: 'default', files: 1 },
      { name: 'uploaded', files: 2 },
    ])
  })

  it('removes a whole theme and leaves the others alone', async () => {
    const { themeTemplates } = setup()
    await themeTemplates.save(ctx, { path: 'templates/post', source: 'a' })
    await themeTemplates.save(ctx, { theme: 'uploaded', path: 'templates/post', source: 'b' })

    expect(await themeTemplates.removeTheme(ctx, 'uploaded')).toBe(1)
    expect(await themeTemplates.list(ctx, 'uploaded')).toEqual([])
    expect(await themeTemplates.list(ctx, 'default')).toHaveLength(1)
  })
})
