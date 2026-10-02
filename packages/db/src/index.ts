/**
 * @typeky/db -- repositories and the Drizzle schema -- the only entry point for data access
 *
 * Layout and responsibilities: CONTRIBUTING.md section 6
 * Architecture red lines: CONTRIBUTING.md section 3
 *
 * The Drizzle schema is deliberately not re-exported here: it would pull the
 * ORM into every Worker bundle for types nothing at runtime needs. Import it
 * from `@typeky/db/schema` when you do need it.
 */

export * from './contracts'
export { createD1Repositories } from './repos/d1'
