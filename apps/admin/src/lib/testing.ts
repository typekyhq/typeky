import type { ApiClient } from './api-client'

/**
 * A stand-in API client for component tests.
 *
 * Every method is present, and everything unexpected throws. The previous shape
 * was an object literal cast to `ApiClient`, which hides exactly what it looks
 * like it checks: a fake missing `listPosts` compiled happily, and the failure
 * surfaced later as an unhandled rejection from a component effect rather than
 * as an error naming the method. Without the cast, adding a method to the client
 * makes every fake incomplete until it is updated, which is the point.
 *
 * Reads that a screen performs merely to render answer with something empty;
 * anything that represents an action throws unless the test says otherwise.
 */

const EMPTY_PAGE = { items: [], total: 0, limit: 20, offset: 0 }

export function fakeApiClient(overrides: Partial<ApiClient> = {}): ApiClient {
  const unexpected = <T>(name: string): (() => Promise<T>) => () => {
    throw new Error(`the test API client received an unexpected call to ${name}`)
  }

  return {
    csrfToken: undefined,
    setCsrfToken() {},

    get: unexpected('get'),
    post: unexpected('post'),
    put: unexpected('put'),
    delete: unexpected('delete'),

    signIn: unexpected('signIn'),
    async signOut() {},
    loadSession: unexpected('loadSession'),

    getSite: unexpected('getSite'),
    saveSite: unexpected('saveSite'),

    async listPosts() {
      return EMPTY_PAGE
    },
    getPost: unexpected('getPost'),
    createPost: unexpected('createPost'),
    savePost: unexpected('savePost'),
    deletePost: unexpected('deletePost'),
    setPostStatus: unexpected('setPostStatus'),

    async listPages() {
      return EMPTY_PAGE
    },
    getPage: unexpected('getPage'),
    createPage: unexpected('createPage'),
    savePage: unexpected('savePage'),
    deletePage: unexpected('deletePage'),
    setPageStatus: unexpected('setPageStatus'),
    setPageHome: unexpected('setPageHome'),

    async listProducts() {
      return EMPTY_PAGE
    },
    getProduct: unexpected('getProduct'),
    createProduct: unexpected('createProduct'),
    saveProduct: unexpected('saveProduct'),
    deleteProduct: unexpected('deleteProduct'),
    setProductStatus: unexpected('setProductStatus'),

    ...overrides,
  }
}
