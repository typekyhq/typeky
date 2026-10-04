import { CSRF_HEADER } from '@typeky/api'
import { model } from '@typeky/core'
import { createD1Repositories, defaultContext, renderMigrationSql, type Repositories } from '@typeky/db'
import { createMemoryDb } from '@typeky/platform/testing'
import { beforeAll, describe, expect, it } from 'vitest'
import { fakeKv, makeTestEnv } from '../testing/env'
import { createAdminApi } from './api'
import type { AdminEnv } from './errors'
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from './password'

/**
 * The taxonomy endpoints.
 *
 * Against the real repositories over an in-memory database rather than stubs,
 * because the interesting part of these handlers is not the mapping -- it is that
 * they agree with the repository about ordering. The depth in a response is
 * computed from the order the terms come back in, so a stub I wrote myself would
 * agree with the handler by construction and prove nothing.
 */

const FAST: ScryptParams = { ...DEFAULT_SCRYPT_PARAMS, N: 1024 }
const PASSWORD = 'correct horse battery staple'

let passwordHash = ''

beforeAll(async () => {
  passwordHash = await hashPassword(PASSWORD, FAST)
})

interface VocabularyBody {
  id: string
  name: string
  description: string | null
  contentTypes: string[]
}

interface TermBody {
  id: string
  vocabularyId: string
  parentId: string | null
  name: string
  slug: string
  depth: number
  usage: number
}

function setup() {
  const db = createMemoryDb()
  db.exec(renderMigrationSql(model))
  const repositories = createD1Repositories(db)

  const api = createAdminApi({ repositories: () => repositories })
  const env: AdminEnv['Bindings'] = makeTestEnv({
    CACHE: fakeKv().kv,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD_HASH: passwordHash,
  })

  async function send(path: string, init?: RequestInit, cookie?: string): Promise<Response> {
    const headers = new Headers(init?.headers)
    if (cookie !== undefined) headers.set('cookie', cookie)
    return api.request(new Request(`https://example.com${path}`, { ...init, headers }), undefined, env)
  }

  /** Signs in and returns a caller that already carries the cookie and token. */
  async function asAdmin(): Promise<(method: string, path: string, body?: unknown) => Promise<Response>> {
    const signIn = await send('/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: PASSWORD }),
    })
    const session = (await signIn.json()) as { csrfToken: string }
    const cookie = (signIn.headers.get('set-cookie') ?? '').split(';')[0] ?? ''

    return (method, path, body) =>
      send(
        path,
        {
          method,
          headers: {
            'content-type': 'application/json',
            [CSRF_HEADER]: session.csrfToken,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        cookie,
      )
  }

  return { db, repositories, send, asAdmin }
}

async function errorMessage(response: Response): Promise<string> {
  return ((await response.json()) as { message?: string }).message ?? ''
}

/** The error code of a refusal, which is what a client branches on. */
async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: string }).error
}

/** Creates a vocabulary through the API and returns it. */
async function makeVocabulary(
  call: (method: string, path: string, body?: unknown) => Promise<Response>,
  body: Record<string, unknown> = {},
): Promise<VocabularyBody> {
  const response = await call('POST', '/taxonomy/vocabularies', {
    name: 'Categories',
    contentTypes: ['post'],
    ...body,
  })
  expect(response.status).toBe(201)
  return (await response.json()) as VocabularyBody
}

async function makeTerm(
  call: (method: string, path: string, body?: unknown) => Promise<Response>,
  body: Record<string, unknown>,
): Promise<TermBody> {
  const response = await call('POST', '/taxonomy/terms', body)
  expect(response.status).toBe(201)
  return (await response.json()) as TermBody
}

describe('reading the taxonomy', () => {
  it('needs a session', async () => {
    const { send } = setup()

    expect((await send('/taxonomy')).status).toBe(401)
  })

  it('starts empty, which is what a fresh deployment sees', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()

    const response = await call('GET', '/taxonomy')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ vocabularies: [], terms: [] })
  })

  it('answers with every term of every vocabulary, indented by depth', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const vocabulary = await makeVocabulary(call)
    const engineering = await makeTerm(call, {
      vocabularyId: vocabulary.id,
      name: 'Engineering',
      slug: 'engineering',
    })
    await makeTerm(call, {
      vocabularyId: vocabulary.id,
      parentId: engineering.id,
      name: 'Frontend',
      slug: 'frontend',
    })

    const body = (await (await call('GET', '/taxonomy')).json()) as {
      vocabularies: VocabularyBody[]
      terms: TermBody[]
    }

    expect(body.vocabularies.map((entry) => entry.name)).toEqual(['Categories'])
    expect(body.terms.map((term) => [term.name, term.depth])).toEqual([
      ['Engineering', 0],
      ['Frontend', 1],
    ])
  })
})

describe('writing vocabularies', () => {
  it('creates one and lists it back', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()

    const created = await makeVocabulary(call, {
      name: 'Product types',
      description: 'What a product is',
      contentTypes: ['post', 'product'],
    })

    expect(created.name).toBe('Product types')
    expect(created.description).toBe('What a product is')
    expect(created.contentTypes).toEqual(['post', 'product'])

    const body = (await (await call('GET', '/taxonomy')).json()) as { vocabularies: VocabularyBody[] }
    expect(body.vocabularies.map((entry) => entry.id)).toEqual([created.id])
  })

  it('refuses a second vocabulary with the same name', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    await makeVocabulary(call)

    const response = await call('POST', '/taxonomy/vocabularies', { name: 'Categories' })

    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('name_taken')
  })

  it('rejects a body with no name', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()

    const response = await call('POST', '/taxonomy/vocabularies', { name: '' })

    expect(response.status).toBe(400)
    expect(await errorMessage(response)).toContain('name')
  })

  it('renames in place', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const vocabulary = await makeVocabulary(call)

    const response = await call('PUT', `/taxonomy/vocabularies/${vocabulary.id}`, { name: 'Topics' })

    expect(response.status).toBe(200)
    expect(((await response.json()) as VocabularyBody).name).toBe('Topics')
  })

  it('answers 404 for a vocabulary that is not there', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()

    expect((await call('PUT', '/taxonomy/vocabularies/missing', { name: 'Topics' })).status).toBe(404)
    expect((await call('DELETE', '/taxonomy/vocabularies/missing')).status).toBe(404)
  })

  it('takes its terms with it', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const vocabulary = await makeVocabulary(call)
    await makeTerm(call, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    expect((await call('DELETE', `/taxonomy/vocabularies/${vocabulary.id}`)).status).toBe(204)

    const body = (await (await call('GET', '/taxonomy')).json()) as { terms: TermBody[] }
    expect(body.terms).toEqual([])
  })
})

describe('writing terms', () => {
  it('creates a root term at depth zero', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const vocabulary = await makeVocabulary(call)

    const term = await makeTerm(call, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    expect(term.parentId).toBeNull()
    expect(term.depth).toBe(0)
    expect(term.usage).toBe(0)
  })

  it('creates a child under a parent', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const vocabulary = await makeVocabulary(call)
    const parent = await makeTerm(call, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    const child = await makeTerm(call, {
      vocabularyId: vocabulary.id,
      parentId: parent.id,
      name: 'Release',
      slug: 'release',
    })

    expect(child.parentId).toBe(parent.id)
    expect(child.depth).toBe(1)
  })

  it('refuses a parent from another vocabulary', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const first = await makeVocabulary(call)
    const second = await makeVocabulary(call, { name: 'Topics' })
    const foreign = await makeTerm(call, { vocabularyId: second.id, name: 'Topic', slug: 'topic' })

    const response = await call('POST', '/taxonomy/terms', {
      vocabularyId: first.id,
      parentId: foreign.id,
      name: 'Child',
      slug: 'child',
    })

    expect(response.status).toBe(400)
    expect(await errorMessage(response)).toContain('another vocabulary')
  })

  it('refuses a slug already used in the same vocabulary', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const vocabulary = await makeVocabulary(call)
    await makeTerm(call, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    const response = await call('POST', '/taxonomy/terms', {
      vocabularyId: vocabulary.id,
      name: 'News again',
      slug: 'news',
    })

    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('slug_taken')
  })

  it('refuses a slug another vocabulary already holds', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const first = await makeVocabulary(call)
    const second = await makeVocabulary(call, { name: 'Topics' })
    await makeTerm(call, { vocabularyId: first.id, name: 'News', slug: 'news' })

    const response = await call('POST', '/taxonomy/terms', {
      vocabularyId: second.id,
      name: 'News',
      slug: 'news',
    })

    // The archive URL is one segment (`/category/{slug}`), so a term's slug has to
    // be unique across the whole site, not only inside its own vocabulary -- without
    // this, only one of the two could ever be reached.
    expect(response.status).toBe(409)
    const body = (await response.json()) as { error: string; message?: string }
    expect(body.error).toBe('slug_taken')
    expect(body.message).toContain('Categories')
  })

  it('rejects a slug that is not a path segment', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const vocabulary = await makeVocabulary(call)

    const response = await call('POST', '/taxonomy/terms', {
      vocabularyId: vocabulary.id,
      name: 'Release notes',
      slug: 'Release Notes',
    })

    expect(response.status).toBe(400)
  })

  it('answers 404 for a vocabulary that does not exist', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()

    const response = await call('POST', '/taxonomy/terms', {
      vocabularyId: 'missing',
      name: 'News',
      slug: 'news',
    })

    expect(response.status).toBe(404)
  })

  it('reports how much content carries a term', async () => {
    const { asAdmin, repositories } = setup()
    const call = await asAdmin()
    const vocabulary = await makeVocabulary(call)
    const term = await makeTerm(call, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })

    await repositories.terms.assign(defaultContext(), 'post', 'post-1', [term.id])

    const body = (await (await call('GET', '/taxonomy')).json()) as { terms: TermBody[] }
    expect(body.terms[0]?.usage).toBe(1)
  })

  it('deletes a term, and its branch with it', async () => {
    const { asAdmin } = setup()
    const call = await asAdmin()
    const vocabulary = await makeVocabulary(call)
    const parent = await makeTerm(call, { vocabularyId: vocabulary.id, name: 'News', slug: 'news' })
    await makeTerm(call, {
      vocabularyId: vocabulary.id,
      parentId: parent.id,
      name: 'Release',
      slug: 'release',
    })

    expect((await call('DELETE', `/taxonomy/terms/${parent.id}`)).status).toBe(204)
    expect((await call('DELETE', `/taxonomy/terms/${parent.id}`)).status).toBe(404)

    const body = (await (await call('GET', '/taxonomy')).json()) as { terms: TermBody[] }
    expect(body.terms).toEqual([])
  })
})
