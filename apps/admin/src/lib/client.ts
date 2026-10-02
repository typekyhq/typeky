import { createApiClient } from './api-client'

/**
 * The client the app uses.
 *
 * One instance for the whole app, because it holds the CSRF token for the
 * current session: a second one would be signed in but unable to write.
 */
export const apiClient = createApiClient()
