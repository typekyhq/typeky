import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * Vitest runs from the repository root and discovers every `*.test.ts(x)` in the
 * workspace, so the `@/` shorthand the admin SPA uses has to be resolvable here
 * as well as in `apps/admin/vite.config.ts`.
 *
 * Only the admin uses that alias -- shadcn/ui components import `@/lib/utils` --
 * so it is mapped to the admin source directly. If a second package ever wants
 * its own `@/`, this is the point to switch to per-project configurations.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./apps/admin/src', import.meta.url)),
    },
  },
  test: {
    // Testing Library only installs its automatic DOM cleanup when `afterEach`
    // is a global, and without it one component test's markup leaks into the
    // next one, producing "found multiple elements" far from the real cause.
    globals: true,
  },
})
