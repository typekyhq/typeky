import type { Repositories } from '@typeky/db'

/**
 * A store for a test that only cares about part of one.
 *
 * Every admin write now revalidates, and revalidating asks the store which paths
 * the site serves -- so a test that exercises a write needs a store that can
 * answer that, not only the repository it is about. Without this, "the endpoint
 * works" would depend on the test having built rows in four unrelated tables.
 *
 * The parts that are not supplied answer as a site with nothing published, which
 * is what those tests mean. Only the readers revalidation uses are filled in: a
 * method this does not stub is still missing, because a test double that answers
 * everything is a test double that hides a call it should have exposed.
 */

/** What a list reader answers when there is nothing to list. */
const NOTHING = { items: [], total: 0, limit: 0, offset: 0 }

/**
 * Each repository may itself be partial: most tests care about one method of one
 * of them, and building the other four so the types line up would be noise.
 */
type StubRepositories = {
  [Key in keyof Repositories]?: Partial<Repositories[Key]>
}

export function stubRepositories(partial: StubRepositories): Repositories {
  const nothing = async (): Promise<typeof NOTHING> => NOTHING

  return {
    ...partial,
    pages: { home: async () => null, list: nothing, ...partial.pages },
    posts: { list: nothing, ...partial.posts },
    products: { list: nothing, ...partial.products },
    // A deployment with no site document yet, which is what a test means unless it
    // says otherwise -- and which still reserves the platform's own paths, because
    // those are a fact about the Worker rather than a setting.
    sites: { get: async () => null, ...partial.sites },
    // Every content read and write now asks about terms: a write attaches the set
    // it was given, a read answers with the ones it has. "None" is what a test
    // means unless it says otherwise, and a test that cares overrides this rather
    // than inheriting an answer it never asked for.
    terms: {
      forContent: async () => [],
      forContentMany: async () => new Map(),
      assign: async () => undefined,
      ...partial.terms,
    },
  } as unknown as Repositories
}
