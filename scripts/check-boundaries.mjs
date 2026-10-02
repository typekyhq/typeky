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
 */
const FORBIDDEN_FOR_SITE = [
  /^@typeky\/editor(?:\/|$)/,
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

if (failures.length > 0) {
  console.error('\nAsset boundary check failed:')
  for (const f of failures) console.error(`  x ${f}`)
  process.exit(1)
}

const note =
  assetsScanned === 0
    ? '(no site build output yet, asset scan skipped)'
    : `(scanned ${siteFilesScanned} source files and ${assetsScanned} build files)`
console.log(`check:boundaries -- passed ${note}`)
