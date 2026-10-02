#!/usr/bin/env tsx
import { DEFAULT_SCRYPT_PARAMS, hashPassword, type ScryptParams } from '../src/admin/password'

/**
 * Generates the hash for the admin password.
 *
 *   printf '%s' 'your password' | pnpm admin:password
 *
 * The password is read from stdin rather than from an argument, because
 * arguments are visible to anything that can list processes.
 *
 * `SCRYPT_N` raises or lowers the cost. The default needs about 25 ms of CPU,
 * which is over the Workers free plan budget; see the notes in password.ts.
 */

async function readPassword(): Promise<string> {
  if (process.stdin.isTTY === true) {
    console.error('error: pipe the password in, so it never appears in the process list')
    console.error("  printf '%s' 'your password' | pnpm admin:password")
    process.exit(1)
  }

  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)

  // A trailing newline is what every shell adds; a password is unlikely to want
  // it, so exactly one is stripped and the rest is left alone.
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '')
}

const password = await readPassword()
if (password === '') {
  console.error('error: the password is empty')
  process.exit(1)
}

const params: ScryptParams = {
  ...DEFAULT_SCRYPT_PARAMS,
  N: Number(process.env.SCRYPT_N ?? DEFAULT_SCRYPT_PARAMS.N),
}

const encoded = await hashPassword(password, params)

if (process.stdout.isTTY !== true) {
  // Piped or redirected: emit only the value.
  console.log(encoded)
} else {
  console.log(`\n${encoded}\n`)
  console.log('Store it as a Worker secret (never in the repository):')
  console.log('  wrangler secret put ADMIN_PASSWORD_HASH --config apps/site/wrangler.jsonc')
  console.log('For local development, put it in apps/site/.dev.vars instead.')
}
