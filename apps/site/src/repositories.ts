import { createD1Repositories, type Repositories } from '@typeky/db'
import { createD1DbPort } from '@typeky/platform'
import type { Env } from './env'

/**
 * Repositories for the current request.
 *
 * Built per request because bindings only exist on the env object. Returning null
 * rather than throwing keeps "the database was never created" a case the API can
 * report clearly instead of turning it into an unexplained 500.
 */
export function repositoriesFor(env: Env): Repositories | null {
  if (env.DB === undefined) return null

  return createD1Repositories(createD1DbPort(env.DB))
}
