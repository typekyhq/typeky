import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * The admin SPA.
 *
 * It builds straight into the shared assets directory, because the Worker
 * uploads `public/` as one tree: `public/admin/` is the SPA, and nothing under
 * it may reference `public/theme/` (architecture section 3.3).
 */
export default defineConfig({
  // Served under /admin/*, so every emitted asset URL has to be rooted there.
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    outDir: '../../public/admin',
    // The SPA owns this directory; the site build never writes into it.
    emptyOutDir: true,
    // Content-hashed names are what make the year-long cache in public/_headers
    // safe to serve.
    assetsDir: 'assets',
  },
  server: {
    // `pnpm dev:admin` runs only Vite. The API lives in the Worker, so it is
    // proxied to `wrangler dev` (architecture sections 9.2 and 11).
    proxy: {
      '/api': { target: 'http://127.0.0.1:8787', changeOrigin: true },
    },
  },
})
