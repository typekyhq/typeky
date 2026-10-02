import { createApp } from './app'

/**
 * Site Worker entry point.
 *
 * Hard constraints (CONTRIBUTING.md section 3, architecture red lines):
 *   - Render with LiquidJS only. No frontend framework, and no Hono JSX.
 *   - Never import @typeky/editor -- the editor belongs to the admin SPA.
 *   - HTML has exactly one producer: the zero-dependency blockToHtml() in @typeky/core.
 */

export type { Env } from './env'

export default createApp()
