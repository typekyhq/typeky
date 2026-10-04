import { describe, expect, it } from 'vitest'
import { ApiError, createApiClient } from './api-client'

const SESSION = {
  actorId: 'admin',
  csrfToken: 'a-token-value',
  createdAt: '2026-01-01T00:00:00.000Z',
}

interface Call {
  url: string
  method: string
  headers: Headers
  body: string | undefined
  credentials: RequestCredentials | undefined
}

/** Records what the client asked for, and answers with whatever the test wants. */
function fakeFetch(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []

  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const call: Call = {
      url,
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : undefined,
      credentials: init?.credentials,
    }
    calls.push(call)
    return handler(call)
  }

  return { calls, fetch: impl as unknown as typeof globalThis.fetch }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  )
}

describe('sign in', () => {
  it('posts the credentials and keeps the returned token', async () => {
    const { calls, fetch } = fakeFetch(() => json(SESSION, 201))
    const client = createApiClient({ fetch })

    await expect(client.signIn({ username: 'admin', password: 'hunter2' })).resolves.toEqual(SESSION)

    expect(calls[0]?.url).toBe('/api/admin/session')
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.headers.get('content-type')).toBe('application/json')
    expect(calls[0]?.body).toBe(JSON.stringify({ username: 'admin', password: 'hunter2' }))
    expect(client.csrfToken).toBe(SESSION.csrfToken)
  })

  it('sends credentials same-origin, which is what carries the session cookie', async () => {
    const { calls, fetch } = fakeFetch(() => json(SESSION, 201))

    await createApiClient({ fetch }).signIn({ username: 'admin', password: 'hunter2' })

    expect(calls[0]?.credentials).toBe('same-origin')
  })

  it('refuses a session response that does not match the contract, instead of caching a bad token', async () => {
    const { fetch } = fakeFetch(() => json({ actorId: 'admin' }))
    const client = createApiClient({ fetch })

    const error = await capture(client.signIn({ username: 'admin', password: 'hunter2' }))

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).message).toContain('contract')
    expect(client.csrfToken).toBeUndefined()
  })
})

describe('branding', () => {
  it('reads the site name and logo from the one public endpoint', async () => {
    const calls: string[] = []
    const client = createApiClient({
      fetch: async (input) => {
        calls.push(String(input))
        return new Response(JSON.stringify({ name: 'Typeky Demo', logoUrl: 'https://x/media/1' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      },
    })

    await expect(client.readBranding()).resolves.toEqual({
      name: 'Typeky Demo',
      logoUrl: 'https://x/media/1',
    })
    // Not under the admin API: this is asked for before there is a session.
    expect(calls).toEqual(['/api/branding'])
  })

  it('throws rather than inventing a name when the response is not the contract', async () => {
    const client = createApiClient({
      fetch: async () => new Response(JSON.stringify({ site: 'nope' }), { status: 200 }),
    })

    await expect(client.readBranding()).rejects.toThrow()
  })
})

describe('session loading', () => {
  it('fetches the current session and keeps its token', async () => {
    const { calls, fetch } = fakeFetch(() => json(SESSION))
    const client = createApiClient({ fetch })

    await expect(client.loadSession()).resolves.toEqual(SESSION)

    expect(calls[0]?.method).toBe('GET')
    expect(client.csrfToken).toBe(SESSION.csrfToken)
  })

  it('reports a missing session as an ApiError rather than a null', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'unauthorized' }, 401))

    const error = await capture(createApiClient({ fetch }).loadSession())

    expect((error as ApiError).code).toBe('unauthorized')
  })
})

describe('the csrf token', () => {
  it('travels on writes', async () => {
    const { calls, fetch } = fakeFetch((call) =>
      call.method === 'POST' && call.url.endsWith('/session') ? json(SESSION, 201) : json({ ok: true }),
    )
    const client = createApiClient({ fetch })
    await client.signIn({ username: 'admin', password: 'hunter2' })

    await client.post('/pages', { title: 'About' })

    expect(calls[1]?.headers.get('x-csrf-token')).toBe(SESSION.csrfToken)
  })

  it('does not travel on reads', async () => {
    const { calls, fetch } = fakeFetch(() => json(SESSION))
    const client = createApiClient({ fetch })
    client.setCsrfToken('a-token-value')

    await client.get('/pages')

    expect(calls[0]?.headers.get('x-csrf-token')).toBeNull()
  })

  it('is dropped when the session has expired, so the next write is not a confusing 403', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'unauthorized' }, 401))
    const client = createApiClient({ fetch })
    client.setCsrfToken('stale')

    await capture(client.get('/pages'))

    expect(client.csrfToken).toBeUndefined()
  })

  it('survives an ordinary failure, which is not a reason to forget it', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'not_found' }, 404))
    const client = createApiClient({ fetch })
    client.setCsrfToken('good')

    await capture(client.get('/pages'))

    expect(client.csrfToken).toBe('good')
  })
})

describe('sign out', () => {
  it('clears the token', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 204 }))
    const client = createApiClient({ fetch })
    client.setCsrfToken('a-token-value')

    await client.signOut()

    expect(client.csrfToken).toBeUndefined()
  })

  it('clears the token even when the request fails', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 500 }))
    const client = createApiClient({ fetch })
    client.setCsrfToken('a-token-value')

    await capture(client.signOut())

    expect(client.csrfToken).toBeUndefined()
  })
})

describe('errors', () => {
  it('turns an error body into one carrying the code and the status', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'csrf_failed' }, 403))

    const error = await capture(createApiClient({ fetch }).post('/pages', {}))

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('csrf_failed')
    expect((error as ApiError).status).toBe(403)
  })

  it('keeps the message when the server sent one', async () => {
    const { fetch } = fakeFetch(() => json({ error: 'not_found', message: 'no such page' }, 404))

    const error = await capture(createApiClient({ fetch }).get('/pages'))

    expect((error as ApiError).message).toBe('no such page')
  })

  it('treats a non-JSON failure as an internal error rather than guessing', async () => {
    const { fetch } = fakeFetch(
      () => new Response('<!doctype html>', { status: 500, headers: { 'content-type': 'text/html' } }),
    )

    const error = await capture(createApiClient({ fetch }).get('/pages'))

    expect((error as ApiError).code).toBe('internal_error')
    expect((error as ApiError).status).toBe(500)
  })

  it('treats a JSON body that is not an error shape the same way', async () => {
    const { fetch } = fakeFetch(() => json({ unexpected: true }, 500))

    const error = await capture(createApiClient({ fetch }).get('/pages'))

    expect((error as ApiError).code).toBe('internal_error')
  })
})

describe('base url', () => {
  it('defaults to the admin prefix and can be overridden', async () => {
    const first = fakeFetch(() => json({ ok: true }))
    await createApiClient({ fetch: first.fetch }).get('/pages')
    expect(first.calls[0]?.url).toBe('/api/admin/pages')

    const second = fakeFetch(() => json({ ok: true }))
    await createApiClient({ fetch: second.fetch, baseUrl: '/api/v1' }).get('/pages')
    expect(second.calls[0]?.url).toBe('/api/v1/pages')
  })
})
