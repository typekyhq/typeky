/**
 * @typeky/db -- Drizzle schema (SQLite) and repositories -- the only entry point for data access
 *
 * Layout and responsibilities: CONTRIBUTING.md section 6
 * Architecture red lines: CONTRIBUTING.md section 3
 *
 * `src/d1/schema.ts` is generated from `packages/core/src/model`; run
 * `pnpm db:generate` after changing the model.
 */

export * from './d1/schema'
