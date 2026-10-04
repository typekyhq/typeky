import type { Env } from '../env'
import { resetAdminPathCache } from '../admin-config'

/**
 * Test doubles for the Worker bindings.
 *
 * Only the members the Worker actually calls are implemented; the rest of each
 * interface is cast away. Keeping them here rather than in each test file means
 * a binding change is one edit.
 */

export interface FakeKv {
  kv: KVNamespace
  /** What has been written, with the TTL each value was given. */
  entries: Map<string, { value: string; expirationTtl?: number }>
}

export function fakeKv(): FakeKv {
  const entries = new Map<string, { value: string; expirationTtl?: number }>()

  const kv = {
    async get(key: string): Promise<string | null> {
      return entries.get(key)?.value ?? null
    },
    async put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void> {
      entries.set(key, { value: String(value), expirationTtl: options?.expirationTtl })
    },
    async delete(key: string): Promise<void> {
      entries.delete(key)
    },
  } as unknown as KVNamespace

  return { kv, entries }
}

export function fakeAssets(files: Record<string, string> = {}, failing = false): Fetcher {
  return {
    async fetch(input: Request | string): Promise<Response> {
      if (failing) throw new Error('assets binding unavailable')

      const url = new URL(typeof input === 'string' ? input : input.url)
      const body = files[url.pathname]
      return body === undefined
        ? new Response('Not Found', { status: 404 })
        : new Response(body, { status: 200, headers: { 'content-type': 'text/html' } })
    },
  } as Fetcher
}

interface FakeStatement {
  bind(): FakeStatement
  all(): Promise<{ results: unknown[] }>
  first(): Promise<unknown>
  run(): Promise<{ meta: { changes: number } }>
}

export function fakeDatabase(query: () => Promise<unknown>): D1Database {
  const statement: FakeStatement = {
    bind: () => statement,
    all: async () => ({ results: [] }),
    first: query,
    run: async () => ({ meta: { changes: 0 } }),
  }

  return { prepare: () => statement, batch: async () => [] } as unknown as D1Database
}

export function makeTestEnv(overrides: Partial<Env> = {}): Env {
  // The panel's path is cached per isolate, and a test process is one isolate running
  // many cases: without this, a case that sets a path would decide the answer for
  // every case after it.
  resetAdminPathCache()

  return {
    APP_ENV: 'test',
    ASSETS: fakeAssets(),
    CACHE: fakeKv().kv,
    ...overrides,
  }
}
