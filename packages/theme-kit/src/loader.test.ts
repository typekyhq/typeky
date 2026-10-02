import { model } from '@typeky/core'
import { renderMigrationSql } from '@typeky/db'
import { createMemoryDb, type MemoryDb } from '@typeky/platform/testing'
import type { DbPort, DbStatement, SqlParam } from '@typeky/platform'
import { describe, expect, it } from 'vitest'
import { createRevisionCache } from './cache'
import { createTemplateLoader, type TemplateLoader } from './loader'
import { createLiquidRuntime } from './runtime'

const baseline: Record<string, string> = {
  'layouts/base': '<html>{% render "snippets/header" %}{{ content }}</html>',
  'snippets/header': '<header>baseline</header>',
  'templates/post': '{% render "snippets/header" %}<article>{{ post.title }}</article>',
}

/** The real schema, so a column rename cannot slip past these tests. */
function createDatabase(): MemoryDb {
  const db = createMemoryDb()
  db.exec(renderMigrationSql(model))
  return db
}

function setup(): { db: MemoryDb; loader: TemplateLoader } {
  const db = createDatabase()
  return { db, loader: createTemplateLoader({ db, theme: 'default', baseline }) }
}

async function saveOverride(db: MemoryDb, path: string, source: string): Promise<void> {
  await db.run(
    `INSERT INTO theme_templates (id, theme, path, source, revision, updated_at)
     VALUES (?, 'default', ?, ?, 1, '2026-01-01T00:00:00.000Z')
     ON CONFLICT(id) DO UPDATE SET source = excluded.source`,
    [`tpl_${path}`, path, source],
  )
}

describe('template loader', () => {
  describe('two-level lookup', () => {
    it('falls back to the baseline', async () => {
      const { loader } = setup()

      expect(await loader.read('templates/post')).toBe(baseline['templates/post'])
    })

    it('prefers an override', async () => {
      const { db, loader } = setup()
      await saveOverride(db, 'templates/post', '<article>overridden</article>')

      expect(await loader.read('templates/post')).toBe('<article>overridden</article>')
    })

    it('answers for a single overridden path without disturbing the rest', async () => {
      const { db, loader } = setup()
      await saveOverride(db, 'snippets/header', '<header>overridden</header>')

      expect(await loader.read('snippets/header')).toBe('<header>overridden</header>')
      expect(await loader.read('templates/post')).toBe(baseline['templates/post'])
    })

    it('accepts a name with the extension or a leading slash', async () => {
      const { loader } = setup()

      expect(await loader.read('templates/post.liquid')).toBe(baseline['templates/post'])
      expect(await loader.read('/templates/post')).toBe(baseline['templates/post'])
    })

    it('refuses a name the theme does not ship', async () => {
      const { loader } = setup()

      await expect(loader.read('templates/secret')).rejects.toThrow(/template not found/)
      await expect(loader.read('../../etc/passwd')).rejects.toThrow(/template not found/)
    })

    it('reports whether a name is overridden', async () => {
      const { db, loader } = setup()
      await saveOverride(db, 'snippets/header', '<header>overridden</header>')

      expect(await loader.isOverridden('snippets/header')).toBe(true)
      expect(await loader.isOverridden('templates/post')).toBe(false)
    })

    it('lists exactly the baseline names, sorted', () => {
      const { loader } = setup()

      expect(loader.list()).toEqual(['layouts/base', 'snippets/header', 'templates/post'])
    })
  })

  describe('whitelist', () => {
    it('accepts a name the theme ships', async () => {
      const { loader } = setup()

      expect(await loader.fs.contains!('.', 'templates/post')).toBe(true)
      expect(await loader.fs.contains!('.', 'templates/post.liquid')).toBe(true)
    })

    it('refuses anything else, including traversal', async () => {
      const { loader } = setup()
      const contains = loader.fs.contains!

      expect(await contains('.', 'templates/secret')).toBe(false)
      expect(await contains('.', '../../etc/passwd')).toBe(false)
      expect(await contains('.', '/etc/passwd')).toBe(false)
      expect(await contains('.', '')).toBe(false)
    })

    it('is not widened by an override, because new files cannot be created', async () => {
      const { db, loader } = setup()
      // A row for a path the theme does not ship, as a migration or a bug could
      // leave behind. It must not become readable.
      await saveOverride(db, 'templates/injected', 'boom')

      expect(await loader.fs.contains!('.', 'templates/injected')).toBe(false)
      expect(await loader.fs.exists!('templates/injected')).toBe(true)
      expect(await loader.read('templates/injected')).toBe('boom')
    })
  })

  describe('caching', () => {
    it('reads the overrides once per revision', async () => {
      const db = createDatabase()
      let queries = 0
      const port: DbPort = {
        all: <T>(sql: string, params?: SqlParam[]) => {
          queries += 1
          return db.all<T>(sql, params)
        },
        first: <T>(sql: string, params?: SqlParam[]) => db.first<T>(sql, params),
        run: (sql: string, params?: SqlParam[]) => db.run(sql, params),
        batch: (statements: DbStatement[]) => db.batch(statements),
      }

      const loader = createTemplateLoader({ db: port, theme: 'default', baseline })
      await loader.read('templates/post')
      await loader.read('snippets/header')
      await loader.read('layouts/base')

      expect(queries).toBe(1)
    })

    it('re-reads after invalidate', async () => {
      const { db, loader } = setup()
      expect(await loader.read('snippets/header')).toBe('<header>baseline</header>')

      await saveOverride(db, 'snippets/header', '<header>overridden</header>')
      expect(await loader.read('snippets/header')).toBe('<header>baseline</header>')

      loader.invalidate()
      expect(await loader.read('snippets/header')).toBe('<header>overridden</header>')
    })

    it('bumps the revision on invalidate', () => {
      const { loader } = setup()
      const before = loader.revision

      loader.invalidate()

      expect(loader.revision).toBe(before + 1)
    })

    it('scopes overrides to the configured theme', async () => {
      const db = createDatabase()
      const defaultLoader = createTemplateLoader({ db, theme: 'default', baseline })
      const otherLoader = createTemplateLoader({ db, theme: 'minimal', baseline })
      await saveOverride(db, 'snippets/header', '<header>overridden</header>')

      expect(await defaultLoader.read('snippets/header')).toBe('<header>overridden</header>')
      expect(await otherLoader.read('snippets/header')).toBe('<header>baseline</header>')
    })

    it('refuses an override set beyond the template cap', async () => {
      const db = createDatabase()
      const loader = createTemplateLoader({ db, theme: 'default', baseline, maxOverrides: 1 })
      await saveOverride(db, 'snippets/header', 'a')
      await saveOverride(db, 'templates/post', 'b')

      await expect(loader.read('templates/post')).rejects.toThrow(/over the 1 limit/)
    })

    it('refuses an override set beyond the source size cap', async () => {
      const db = createDatabase()
      const loader = createTemplateLoader({ db, theme: 'default', baseline, maxOverrideBytes: 10 })
      await saveOverride(db, 'snippets/header', 'x'.repeat(50))

      await expect(loader.read('snippets/header')).rejects.toThrow(/over the 10 limit/)
    })
  })

  describe('rendering through the runtime', () => {
    function wire() {
      const { db, loader } = setup()
      const runtime = createLiquidRuntime({
        fs: loader.fs,
        cache: createRevisionCache({ revision: () => loader.revision }),
      })
      const render = () => runtime.engine.renderFile('templates/post', { post: { title: 'Hi' } })
      return { db, loader, render }
    }

    it('resolves a rendered snippet from the baseline', async () => {
      const { render } = wire()

      expect(await render()).toBe('<header>baseline</header><article>Hi</article>')
    })

    it('keeps serving the old snippet until the loader is invalidated', async () => {
      const { db, loader, render } = wire()
      expect(await render()).toBe('<header>baseline</header><article>Hi</article>')

      await saveOverride(db, 'snippets/header', '<header>overridden</header>')

      // Documented behaviour: saving a template is not enough on its own. The
      // caller bumps the revision, which is what clears both caches.
      expect(await render()).toBe('<header>baseline</header><article>Hi</article>')

      loader.invalidate()
      expect(await render()).toBe('<header>overridden</header><article>Hi</article>')
    })

    it('fails the render for a template the theme does not ship', async () => {
      const { loader } = setup()
      const runtime = createLiquidRuntime({ fs: loader.fs })

      await expect(runtime.engine.renderFile('templates/secret', {})).rejects.toThrow()
    })

    it('does not resolve a relative name', async () => {
      const { loader } = setup()
      const runtime = createLiquidRuntime({ fs: loader.fs })

      await expect(
        runtime.render('{% render "./snippets/header" %}', {}),
      ).rejects.toThrow()
    })
  })
})
