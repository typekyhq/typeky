import { createContext, useContext } from 'react'
import type { ApiClient } from './api-client'
import { apiClient } from './client'

/**
 * The client, for screens that need it.
 *
 * Passed through context rather than imported directly so a test can hand a
 * screen a fake without reaching into module state.
 */
const ApiClientContext = createContext<ApiClient>(apiClient)

export const ApiClientProvider = ApiClientContext.Provider

export function useApiClient(): ApiClient {
  return useContext(ApiClientContext)
}
