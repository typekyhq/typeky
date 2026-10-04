import { CSRF_HEADER, type ThemeListResponse } from '@typeky/api'
import type { PageResult, Repositories, Site, SiteRepository, ThemeTemplate, ThemeTemplateRepository } from '@typeky/db'
import { beforeAll, describe, expect, it } from 'vitest'
import { fakeKv, makeTestEnv } from '../testing/env'
import { createAdminApi } from './api'
import type { AdminEnv, RepositoryResolver } from './errors'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'
import { BASELINE_NAMES } from '@typeky/theme-default'
import { stubRepositories } from '../testing/repositories'

/**
 * The theme endpoints.
 *
 * The property these exist to protect is that the theme's own files are the
 * complete set of readable names. An override cannot introduce a new one, so a
 * name the theme does not ship is refused without touching the database at all --
 * which is what makes this a whitelist rather than a prefix check.
 */

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

function fakeRepositories(overrides: ThemeTemplate[] = []) {
  const rows = new Map(overrides.map((row) => [row.path, row]))

  const themes: ThemeTemplateRepository = {
    async list() {
      return [...rows.values()]
    },
    async byPath(_ctx, _theme, path) {
      return rows.get(path) ?? null
    },
    async themes() {
      const byTheme = new Map<string, number>()
      for (const row of rows.values()) byTheme.set(row.theme, (byTheme.get(row.theme) ?? 0) + 1)
      return [...byTheme].map(([name, files]) => ({
        name,
        files,
        updatedAt: new Date('2026-03-03T00:00:00.000Z'),
      }))
    },
    async save(_ctx, input) {
      const existing = rows.get(input.path)
      const saved: ThemeTemplate = {
        id: existing?.id ?? 'row_1',
        theme: input.theme ?? 'default',
        path: input.path,
        source: input.source,
        originalSource: existing?.originalSource ?? input.originalSource ?? null,
        revision: (existing?.revision ?? 0) + 1,
        updatedAt: new Date('2026-03-03T00:00:00.000Z'),
      }
      rows.set(saved.path, saved)
      return saved
    },
    async restore(_ctx, _theme, path) {
      return rows.delete(path)
    },
    async removeTheme() {
      const before = rows.size
      rows.clear()
      return before
    },
  }

  const sites: SiteRepository = {
    async get() {
      return { theme: 'default' } as Site
    },
    async save() {
      throw new Error('not used')
    },
  }

  const list: PageResult<ThemeTemplate> = { items: [], total: 0, limit: 20, offset: 0 }
  void list

  return { repository: stubRepositories({ sites, themeTemplates: themes }), rows }
}

function setup(repositories?: RepositoryResolver) {
  const cache = fakeKv()
  const api = createAdminApi({ repositories: repositories ?? (() => fakeRepositories().repository) })

  const env: AdminEnv['Bindings'] = makeTestEnv({
    CACHE: cache.kv,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: passwordHash,
  })

  async function send(path: string, init?: RequestInit, cookie?: string): Promise<Response> {
    const headers = new Headers(init?.headers)
    if (cookie !== undefined) headers.set('cookie', cookie)
    return api.request(new Request(`https://example.com${path}`, { ...init, headers }), undefined, env)
  }

  async function signIn(): Promise<{ cookie: string; csrfToken: string }> {
    const response = await send('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: PASSWORD }),
    })
    const session = (await response.json()) as { csrfToken: string }
    return {
      cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '',
      csrfToken: session.csrfToken,
    }
  }

  return { send, signIn }
}

describe('listing the theme', () => {
  it('needs a session', async () => {
    const { send } = setup()

    expect((await send('/theme/templates')).status).toBe(401)
  })

  it('lists exactly what the theme ships, grouped', async () => {
    const { send, signIn } = setup()
    const { cookie } = await signIn()

    const response = await send('/theme/templates', undefined, cookie)
    const body = (await response.json()) as {
      theme: string
      items: { path: string; group: string; overridden: boolean }[]
    }

    expect(response.status).toBe(200)
    expect(body.theme).toBe('default')
    expect(body.items.map((item) => item.path).sort()).toEqual([...BASELINE_NAMES].sort())
    expect(body.items.every((item) => ['layouts', 'templates', 'snippets'].includes(item.group))).toBe(true)
  })

  it('marks the ones the site has its own copy of', async () => {
    const overridden = fakeRepositories([
      {
        id: 'x',
        theme: 'default',
        path: 'templates/post',
        source: '<h1>{{ content.title }}</h1>',
        originalSource: null,
        revision: 1,
        updatedAt: new Date('2026-02-02T00:00:00.000Z'),
      },
    ])

    const { send, signIn } = setup(() => overridden.repository)
    const { cookie } = await signIn()

    const body = (await (await send('/theme/templates', undefined, cookie)).json()) as {
      items: { path: string; overridden: boolean; updatedAt: string | null }[]
    }

    const post = body.items.find((item) => item.path === 'templates/post')
    const other = body.items.find((item) => item.path === 'templates/page')

    expect(post?.overridden).toBe(true)
    expect(post?.updatedAt).toBe('2026-02-02T00:00:00.000Z')
    expect(other?.overridden).toBe(false)
  })

  it('says so when the site names a theme this build does not bundle', async () => {
    const store = fakeRepositories()
    store.repository.sites.get = async () => ({ theme: 'fancy' }) as Site

    const { send, signIn } = setup(() => store.repository)
    const { cookie } = await signIn()

    const response = await send('/theme/templates', undefined, cookie)

    expect(response.status).toBe(404)
  })
})

describe('saving one template', () => {
  it('stores a template that parses, and marks it overridden', async () => {
    const store = fakeRepositories()
    const { send, signIn } = setup(() => store.repository)
    const { cookie, csrfToken } = await signIn()

    const source = "{% layout 'layouts/base' %}\n<h1>Custom</h1>\n"
    const response = await send(
      '/theme/template',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
        body: JSON.stringify({ path: 'templates/post', source }),
      },
      cookie,
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ path: 'templates/post', overridden: true })
    expect((await store.repository.themeTemplates.byPath({} as never, 'default', 'templates/post'))?.source).toBe(source)
  })

  it('refuses a template that will not parse, and points at the line', async () => {
    const store = fakeRepositories()
    const { send, signIn } = setup(() => store.repository)
    const { cookie, csrfToken } = await signIn()

    const response = await send(
      '/theme/template',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
        body: JSON.stringify({ path: 'templates/post', source: 'one\ntwo\n{% if a %}\n' }),
      },
      cookie,
    )

    expect(response.status).toBe(400)

    const body = (await response.json()) as { error: string; message?: string; line?: number }
    expect(body.error).toBe('invalid_request')
    expect(body.line).toBe(3)

    // And nothing was written: a template that will not parse is one that 500s
    // the moment its page is asked for.
    const stored = await store.repository.themeTemplates.byPath({} as never, 'default', 'templates/post')
    expect(stored).toBeNull()
  })

  it('refuses a name the theme does not ship, without storing anything', async () => {
    const store = fakeRepositories()
    const { send, signIn } = setup(() => store.repository)
    const { cookie, csrfToken } = await signIn()

    const response = await send(
      '/theme/template',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
        body: JSON.stringify({ path: '../../etc/passwd', source: 'x' }),
      },
      cookie,
    )

    expect(response.status).toBe(404)
    await expect(store.repository.themeTemplates.list({} as never, 'default')).resolves.toEqual([])
  })

  it('refuses a source larger than a template should ever be', async () => {
    const store = fakeRepositories()
    const { send, signIn } = setup(() => store.repository)
    const { cookie, csrfToken } = await signIn()

    const response = await send(
      '/theme/template',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
        body: JSON.stringify({ path: 'templates/post', source: 'x'.repeat(65 * 1024) }),
      },
      cookie,
    )

    expect(response.status).toBe(400)
  })

  it('needs the CSRF token, like every other write', async () => {
    const store = fakeRepositories()
    const { send, signIn } = setup(() => store.repository)
    const { cookie } = await signIn()

    const response = await send(
      '/theme/template',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: 'templates/post', source: 'x' }),
      },
      cookie,
    )

    expect(response.status).toBe(403)
  })
})

describe('uploading a theme', () => {
  const FILES = [
    { path: 'layouts/base', source: '<main>{% block %}{% endblock %}</main>' },
    { path: 'templates/404', source: '<h1>Not found</h1>' },
    { path: 'templates/home', source: '<h1>{{ content.title }}</h1>' },
    { path: 'templates/page', source: '<h1>{{ content.title }}</h1>' },
    { path: 'templates/post', source: '<h1>{{ content.title }}</h1>' },
    { path: 'templates/posts', source: '<h1>{{ content.title }}</h1>' },
    { path: 'templates/product', source: '<h1>{{ content.title }}</h1>' },
    { path: 'templates/products', source: '<h1>{{ content.title }}</h1>' },
    { path: 'assets/theme.css', source: 'body { margin: 0 }' },
  ]

  async function upload(body: unknown): Promise<Response> {
    const store = fakeRepositories()
    const { send, signIn } = setup(() => store.repository)
    const auth = await signIn()

    return send(
      '/theme/themes',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: auth.csrfToken },
        body: JSON.stringify(body),
      },
      auth.cookie,
    )
  }

  it('stores every file and answers with the list', async () => {
    const response = await upload({ name: 'minimal', files: FILES })

    expect(response.status).toBe(201)
    const body = (await response.json()) as ThemeListResponse
    expect(body.themes.map((theme) => theme.name)).toContain('minimal')
    expect(body.active).toBe('default')
  })

  it('refuses a path a theme may not hold', async () => {
    // Traversal is the one that matters, and it is refused before anything is read.
    const response = await upload({
        name: 'minimal',
        files: [...FILES, { path: '../secrets', source: 'x' }],
      })

    expect(response.status).toBe(400)
  })

  it('refuses a template that will not parse', async () => {
    // A theme that half-works fails on a page rather than at the door, so the door is
    // where it is stopped -- with the line, so the author can find it.
    const broken = FILES.map((file) =>
        file.path === 'templates/post' ? { path: 'templates/post', source: '{% if %}' } : file,
      )
      const response = await upload({ name: 'minimal', files: broken })

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ error: 'invalid_request' })
  })

  it('accepts a theme that leaves some files to the bundled one', async () => {
    // A theme is layered over the default, so a partial one is not an error: the files
    // it does not ship render with the bundled theme's.
    const response = await upload({ name: 'partial', files: [{ path: 'assets/theme.css', source: 'x' }] })

    expect(response.status).toBe(201)
  })

  it('refuses the bundled theme name', async () => {
    expect((await upload({ name: 'default', files: FILES })).status).toBe(400)
  })
})

describe('restoring the bundled template', () => {
  it('drops the override and answers 204', async () => {
    const store = fakeRepositories([
      {
        id: 'row_1',
        theme: 'default',
        path: 'templates/post',
        source: 'custom',
        originalSource: null,
        revision: 2,
        updatedAt: new Date('2026-03-03T00:00:00.000Z'),
      },
    ])
    const { send, signIn } = setup(() => store.repository)
    const { cookie, csrfToken } = await signIn()

    const response = await send(
      '/theme/template?path=templates/post',
      { method: 'DELETE', headers: { [CSRF_HEADER]: csrfToken } },
      cookie,
    )

    expect(response.status).toBe(204)

    // And the bundled source is what a read answers with now.
    const after = (await (
      await send('/theme/template?path=templates/post', undefined, cookie)
    ).json()) as { source: string; overridden: boolean }
    expect(after.overridden).toBe(false)
    expect(after.source).toContain("{% layout 'layouts/base' %}")
  })

  it('says so when there was nothing to restore', async () => {
    const store = fakeRepositories()
    const { send, signIn } = setup(() => store.repository)
    const { cookie, csrfToken } = await signIn()

    // "Restored" when nothing was overridden would be a lie the operator cannot
    // see through.
    const response = await send(
      '/theme/template?path=templates/post',
      { method: 'DELETE', headers: { [CSRF_HEADER]: csrfToken } },
      cookie,
    )

    expect(response.status).toBe(404)
  })

  it('refuses a name the theme does not ship', async () => {
    const store = fakeRepositories()
    const { send, signIn } = setup(() => store.repository)
    const { cookie, csrfToken } = await signIn()

    const response = await send(
      '/theme/template?path=templates/mine',
      { method: 'DELETE', headers: { [CSRF_HEADER]: csrfToken } },
      cookie,
    )

    expect(response.status).toBe(404)
  })
})

describe('reading one template', () => {
  it('answers with the bundled source when there is no override', async () => {
    const { send, signIn } = setup()
    const { cookie } = await signIn()

    const response = await send('/theme/template?path=templates/post', undefined, cookie)
    const body = (await response.json()) as { source: string; overridden: boolean }

    expect(response.status).toBe(200)
    expect(body.overridden).toBe(false)
    expect(body.source).toContain("{% layout 'layouts/base' %}")
  })

  it('answers with the override when there is one', async () => {
    const overridden = fakeRepositories([
      {
        id: 'x',
        theme: 'default',
        path: 'templates/post',
        source: 'CUSTOM',
        originalSource: null,
        revision: 1,
        updatedAt: new Date('2026-02-02T00:00:00.000Z'),
      },
    ])

    const { send, signIn } = setup(() => overridden.repository)
    const { cookie } = await signIn()

    const body = (await (
      await send('/theme/template?path=templates/post', undefined, cookie)
    ).json()) as { source: string; overridden: boolean }

    expect(body.source).toBe('CUSTOM')
    expect(body.overridden).toBe(true)
  })

  it('refuses a name the theme does not ship, and never asks the database', async () => {
    let asked = false
    const store = fakeRepositories()
    store.repository.themeTemplates.byPath = async () => {
      asked = true
      return null
    }

    const { send, signIn } = setup(() => store.repository)
    const { cookie } = await signIn()

    for (const path of [
      'templates/nope',
      '../../etc/passwd',
      '/etc/passwd',
      'layouts/base.liquid',
      '',
    ]) {
      const response = await send(`/theme/template?path=${encodeURIComponent(path)}`, undefined, cookie)

      expect(response.status, path).toBe(404)
      await expect(response.json()).resolves.toMatchObject({ error: 'not_found' })
    }

    // The baseline is the whitelist, so a name outside it is refused before the
    // lookup -- there is nothing to look up.
    expect(asked).toBe(false)
  })

  it('cannot be used to create a template the theme does not ship', async () => {
    const store = fakeRepositories()
    const { send, signIn } = setup(() => store.repository)
    const { cookie, csrfToken } = await signIn()

    // Red line 7: a site edits what its theme ships and nothing more. The write
    // endpoint exists now, and this is the property that has to hold -- a new
    // file is not a thing that can be stored, whatever method asks.
    const response = await send(
      '/theme/template',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json', [CSRF_HEADER]: csrfToken },
        body: JSON.stringify({ path: 'templates/mine', source: '<h1>Mine</h1>' }),
      },
      cookie,
    )

    expect(response.status).toBe(404)
    await expect(store.repository.themeTemplates.list({} as never, 'default')).resolves.toEqual([])
  })
})

describe('the template reference', () => {
  it('needs a session', async () => {
    const { send } = setup()

    expect((await send('/theme/context?template=templates/page')).status).toBe(401)
  })

  it('answers with the paths a page template may read', async () => {
    const { send, signIn } = setup()
    const { cookie } = await signIn()

    const response = await send('/theme/context?template=templates/page', undefined, cookie)
    const body = (await response.json()) as { template: string; paths: string[] }

    expect(response.status).toBe(200)
    expect(body.template).toBe('templates/page')
    expect(body.paths).toContain('content.title')
    expect(body.paths).toContain('site.name')
    // The reference in a page's editor is the page's own context, so a post-only
    // field would be a lie told in the place an author is looking for the truth.
    expect(body.paths).not.toContain('content.terms')
  })

  it('answers with the tags and filters the sandbox allows', async () => {
    const { send, signIn } = setup()
    const { cookie } = await signIn()

    const response = await send('/theme/context?template=templates/page', undefined, cookie)
    const body = (await response.json()) as {
      tags: string[]
      platformFilters: string[]
      nativeFilters: string[]
    }

    // The engine's whitelists, not a summary of them: `{% include %}` is allowed and
    // `{% section %}` is not, and the only way to say that accurately is to read the
    // list the engine was built with.
    expect(body.tags).toContain('render')
    expect(body.tags).toContain('if')
    expect(body.platformFilters).toContain('render_blocks')
    expect(body.platformFilters).toContain('asset_url')
    expect(body.nativeFilters).toContain('date')
  })

  it('refuses a template the theme does not ship', async () => {
    const { send, signIn } = setup()
    const { cookie } = await signIn()

    // A name the theme does not ship is not something with a context to describe,
    // and the walker would otherwise answer for a template nobody can write.
    expect((await send('/theme/context?template=templates/mine', undefined, cookie)).status).toBe(404)
    expect((await send('/theme/context', undefined, cookie)).status).toBe(404)
  })
})

