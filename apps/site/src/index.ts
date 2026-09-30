import { Hono } from 'hono'

/**
 * Site Worker -- the customer-facing public site.
 *
 * Hard constraints (CONTRIBUTING.md section 3, architecture red lines):
 *   - Render with LiquidJS only. No frontend framework (React / Vue / Svelte, ...).
 *   - Never import @typeky/editor -- the editor belongs to the admin SPA.
 *   - HTML has exactly one producer: the zero-dependency blockToHtml() in @typeky/core.
 */
export interface Env {
  APP_ENV: string
  // Resource bindings (DB / MEDIA / CACHE / ASSETS) get typed by `pnpm types`
  // once the corresponding Cloudflare resources exist.
}

const app = new Hono<{ Bindings: Env }>()

app.get('/healthz', (c) => c.json({ ok: true, env: c.env.APP_ENV }))

// TODO(M1): mount the Liquid render pipeline (@typeky/theme-kit) and the site routes
app.get('/', (c) => c.text('Typeky - CE MVP skeleton is running\n'))

export default app
