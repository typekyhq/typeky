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

/** What a deployment nobody has set up yet returns. */
const EMPTY_SITE = {
  name: '',
  tagline: null,
  logoMediaId: null,
  theme: 'default',
  settings: {},
  nav: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
}

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

    // A shell-level read now, not only the settings screen's: the panel's own
    // language and date format are stored in the site document, so every screen
    // asks for it once. An empty document is what a screen that has not been set
    // up yet sees, and it renders.
    async getSite() {
      return EMPTY_SITE
    },
    saveSite: unexpected('saveSite'),

    // A free deployment, which is what a component test means unless it says
    // otherwise: the badge is on screen.
    async getLicense() {
      return { whiteLabel: false, domain: 'example.com' }
    },

    async listPosts() {
      return EMPTY_PAGE
    },
    getPost: unexpected('getPost'),
    createPost: unexpected('createPost'),
    savePost: unexpected('savePost'),
    deletePost: unexpected('deletePost'),
    setPostStatus: unexpected('setPostStatus'),
    bulkPosts: unexpected('bulkPosts'),

    async listPages() {
      return EMPTY_PAGE
    },
    getPage: unexpected('getPage'),
    createPage: unexpected('createPage'),
    savePage: unexpected('savePage'),
    deletePage: unexpected('deletePage'),
    setPageStatus: unexpected('setPageStatus'),
    setPageHome: unexpected('setPageHome'),
    bulkPages: unexpected('bulkPages'),

    async listProducts() {
      return EMPTY_PAGE
    },
    getProduct: unexpected('getProduct'),
    createProduct: unexpected('createProduct'),
    saveProduct: unexpected('saveProduct'),
    deleteProduct: unexpected('deleteProduct'),
    setProductStatus: unexpected('setProductStatus'),
    bulkProducts: unexpected('bulkProducts'),

    async listMedia() {
      return EMPTY_PAGE
    },
    uploadMedia: unexpected('uploadMedia'),
    mediaUsages: unexpected('mediaUsages'),
    deleteMedia: unexpected('deleteMedia'),
    mediaContentUrl(id: string) {
      return `/api/admin/media/${id}/content`
    },
    listThemeTemplates: async () => ({ theme: 'default', items: [] }),
    // An empty reference renders: that is what a component test means unless it
    // says otherwise, and the panel's own test supplies a real one.
    getThemeContext: async (template: string) => ({
      template,
      paths: [],
      tags: [],
      platformFilters: [],
      nativeFilters: [],
    }),
    getThemeTemplate: unexpected('getThemeTemplate'),
    saveThemeTemplate: unexpected('saveThemeTemplate'),
    previewThemeTemplate: unexpected('previewThemeTemplate'),
    resetThemeTemplate: unexpected('resetThemeTemplate'),

    // A site with no taxonomy renders the screen's own empty state, which is
    // what a component test means unless it overrides this.
    readTaxonomy: async () => ({ vocabularies: [], terms: [] }),
    createVocabulary: unexpected('createVocabulary'),
    saveVocabulary: unexpected('saveVocabulary'),
    deleteVocabulary: unexpected('deleteVocabulary'),
    createTerm: unexpected('createTerm'),
    saveTerm: unexpected('saveTerm'),
    deleteTerm: unexpected('deleteTerm'),

    ...overrides,
  }
}
