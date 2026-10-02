#!/usr/bin/env node
/**
 * Asset boundary assertions (CONTRIBUTING.md section 3, red lines 1 / 2 / 6).
 *
 * Runs in CI and after local builds to ensure:
 *   1. The site Worker source never imports a frontend framework, Hono JSX, or
 *      @typeky/editor (red lines 1 and 6).
 *   2. The site build output contains no frontend framework or editor runtime code.
 *
 * When no build output exists yet, the asset scan is skipped -- that is not a failure.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '..')
const failures = []

/** Strip comments so that merely *mentioning* a package name in prose is not flagged. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Collect only import / export-from / require / dynamic-import *specifiers*.
 * Specifiers are always quoted, so comments and prose never match.
 */
function importedSpecifiers(src) {
  const clean = stripComments(src)
  const out = []
  const patterns = [
    /(?:^|\n)\s*import\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
    /(?:^|\n)\s*export\s[^'"\n]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const re of patterns) {
    for (const m of clean.matchAll(re)) out.push(m[1])
  }
  return out
}

function walk(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    return statSync(full).isDirectory() ? walk(full) : [full]
  })
}

/**
 * Red line 1: the site side renders through LiquidJS only. Enforced at the source
 * level here, and again against the build output below.
 *
 * The admin SPA is included because the two sides must not reach into each other
 * (red line 2): the site may not import the admin, and the admin may not import
 * the theme runtime.
 */
const FORBIDDEN_FOR_SITE = [
  /^@typeky\/editor(?:\/|$)/,
  /^@typeky\/admin(?:\/|$)/,
  /^hono\/jsx(?:\/|$)/,
  /^react(?:\/|$)/,
  /^react-dom(?:\/|$)/,
  /^preact(?:\/|$)/,
  /^vue(?:\/|$)/,
  /^svelte(?:\/|$)/,
  /^solid-js(?:\/|$)/,
  /^@tiptap\//,
  /^prosemirror-/,
]

// ---- 1. The site Worker must not reference a forbidden package ----
const siteSrc = join(root, 'apps/site/src')
let siteFilesScanned = 0
for (const file of walk(siteSrc)) {
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue
  siteFilesScanned++
  for (const spec of importedSpecifiers(readFileSync(file, 'utf8'))) {
    for (const re of FORBIDDEN_FOR_SITE) {
      if (re.test(spec)) {
        failures.push(`site Worker imports a forbidden package (red line 1): ${file} -> ${spec}`)
      }
    }
  }
}

// ---- 2. Site build output must not contain framework or editor runtime ----
const frameworkSignatures = [
  'react-dom',
  'React.createElement',
  '__REACT_DEVTOOLS_GLOBAL_HOOK__',
  'ProseMirror',
  '@tiptap',
]

let assetsScanned = 0
for (const rel of ['public/theme', 'public/static']) {
  for (const file of walk(join(root, rel))) {
    if (!/\.(js|mjs|css|html)$/.test(file)) continue
    assetsScanned++
    const src = readFileSync(file, 'utf8')
    for (const sig of frameworkSignatures) {
      if (src.includes(sig)) failures.push(`site asset looks like framework code (${sig}): ${file}`)
    }
  }
}

// ---- 3. The admin bundle must not carry the theme runtime ----
/**
 * String literals rather than module names, because the bundle is minified and
 * identifiers do not survive. These are messages only the Liquid side produces.
 */
const THEME_SIGNATURES = [
  'template render limit exceeded',
  'memory alloc limit exceeded',
  'template not found: ',
]

/** Section 3.3 caps the admin first screen at 350 KB gzipped. */
const ADMIN_FIRST_SCREEN_BUDGET_BYTES = 350 * 1024

/** Section 3.11 caps the editor chunk at 200 KB gzipped. */
const EDITOR_CHUNK_BUDGET_BYTES = 200 * 1024

const adminDir = join(root, 'public/admin')
const adminIndex = join(adminDir, 'index.html')
let adminNote = ''

if (!existsSync(adminIndex)) {
  // Not a skip. Silently passing here is how the budget and the bundle scan went
  // unenforced: the check reads build output, so it has to be told to fail when
  // there is none.
  failures.push('no admin build output: run `pnpm build` before the boundary check')
} else {
  const html = readFileSync(adminIndex, 'utf8')
  const referenced = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => match[1])
    .filter((url) => url.startsWith('/admin/'))

  let firstScreenGzip = 0
  for (const url of referenced) {
    const file = join(adminDir, url.replace(/^\/admin\//, ''))
    if (!existsSync(file)) continue
    firstScreenGzip += gzipSync(readFileSync(file)).length
  }

  if (referenced.length === 0) {
    failures.push('admin index.html references no assets, so the size budget cannot be checked')
  } else if (firstScreenGzip > ADMIN_FIRST_SCREEN_BUDGET_BYTES) {
    const kb = (n) => `${Math.round(n / 1024)} KB`
    failures.push(
      `admin first screen is ${kb(firstScreenGzip)} gzipped, over the ${kb(ADMIN_FIRST_SCREEN_BUDGET_BYTES)} budget`,
    )
  }

  // ---- The editor loads only on the edit screen ----
  /**
   * Checked as an invariant rather than trusted, because breaking it does not
   * look like breaking it. A `manualChunks` entry once merged the editor's
   * modules into a chunk the entry imported statically: every size number stayed
   * plausible, the first screen still "excluded" the editor, and index.html had
   * quietly gained a `<script>` tag for it -- so the editor downloaded on first
   * paint anyway. Both directions are asserted here.
   */
  const editorChunks = []
  for (const file of walk(join(adminDir, 'assets'))) {
    if (/\/editor-[^/]*\.js$/.test(file)) editorChunks.push(file)
  }

  let editorNote = ''
  if (editorChunks.length === 0) {
    failures.push(
      'no editor chunk in the admin build: the editor is missing, or it has been bundled into the first screen',
    )
  } else {
    let editorGzip = 0
    for (const file of editorChunks) editorGzip += gzipSync(readFileSync(file)).length

    if (editorGzip > EDITOR_CHUNK_BUDGET_BYTES) {
      const kb = (n) => `${Math.round(n / 1024)} KB`
      failures.push(
        `editor chunk is ${kb(editorGzip)} gzipped, over the ${kb(EDITOR_CHUNK_BUDGET_BYTES)} budget`,
      )
    }

    editorNote = `, editor chunk ${Math.round(editorGzip / 1024)} KB gzipped of ${Math.round(
      EDITOR_CHUNK_BUDGET_BYTES / 1024,
    )} KB`
  }

  for (const url of referenced) {
    if (/\/editor-/.test(url)) {
      failures.push(`admin index.html loads the editor chunk on first paint (${url})`)
    }

    const file = join(adminDir, url.replace(/^\/admin\//, ''))
    if (!existsSync(file)) continue
    const src = readFileSync(file, 'utf8')
    for (const sig of ['@tiptap', 'ProseMirror', 'cm-content']) {
      if (src.includes(sig)) {
        failures.push(
          `the editor is inside the first screen (${sig} in ${url}); it must load only on the edit screen`,
        )
      }
    }
  }

  adminNote = `(admin first screen ${Math.round(firstScreenGzip / 1024)} KB gzipped of ${Math.round(
    ADMIN_FIRST_SCREEN_BUDGET_BYTES / 1024,
  )} KB${editorNote})`

  for (const file of walk(adminDir)) {
    if (!/\.(js|css|html)$/.test(file)) continue
    const src = readFileSync(file, 'utf8')
    for (const sig of THEME_SIGNATURES) {
      if (src.includes(sig)) failures.push(`admin bundle carries the theme runtime (${sig}): ${file}`)
    }
  }
}

if (failures.length > 0) {
  console.error('\nAsset boundary check failed:')
  for (const f of failures) console.error(`  x ${f}`)
  process.exit(1)
}

const note =
  assetsScanned === 0
    ? '(no site build output yet, asset scan skipped)'
    : `(scanned ${siteFilesScanned} source files and ${assetsScanned} build files)`
console.log(`check:boundaries -- passed ${note} ${adminNote}`)