import { configure } from '@testing-library/dom'

/**
 * Global test setup.
 *
 * The default async timeout is one second, which is fine on an idle machine and
 * not fine in `pnpm check`, where eleven `tsc` processes have just finished and
 * the suite starts immediately: a component that mounts a popup can take longer
 * than that under load, and the failure looks like a missing element rather than
 * a slow one.
 *
 * Tests that assert on timing still fail if they are wrong; this only stops the
 * machine deciding the outcome.
 */
if (typeof document !== 'undefined') {
  configure({ asyncUtilTimeout: 5_000 })
}
