#!/usr/bin/env node
/**
 * Runs both dev servers with one command (architecture section 11):
 * the Worker on 8787 and the admin SPA on 5173, with Vite proxying /api to the
 * Worker (see apps/admin/vite.config.ts).
 *
 * The site side needs no bundler -- it is rendered by the Worker, so only the
 * admin gets a Vite process.
 */
import { spawn } from 'node:child_process'

const children = [
  spawn('pnpm', ['--filter', '@typeky/site', 'dev'], { stdio: 'inherit' }),
  spawn('pnpm', ['--filter', '@typeky/admin', 'dev'], { stdio: 'inherit' }),
]

let stopping = false

function stop(signal) {
  if (stopping) return
  stopping = true
  for (const child of children) child.kill(signal)
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stop(signal)
    process.exit(0)
  })
}

// Ctrl-C reaches the whole process group, but a child that dies on its own --
// a port collision, say -- should take the other one down with it rather than
// leaving half a dev environment running.
for (const child of children) {
  child.on('exit', (code) => {
    if (stopping) return
    stop('SIGTERM')
    process.exit(code ?? 0)
  })
}
