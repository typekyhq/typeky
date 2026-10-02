/**
 * Test support. Imported as `@typeky/platform/testing`.
 *
 * Kept out of the package root export so application code cannot accidentally
 * pull a Node builtin into a Worker bundle.
 */
export { createMemoryDb, type MemoryDb } from './memory-db'
