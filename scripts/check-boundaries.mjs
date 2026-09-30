#!/usr/bin/env node
/**
 * 资产边界断言（CONTRIBUTING.md §3 架构红线）
 *
 * 在 CI 与本地构建后运行，确保：
 *   1. 站点 Worker 源码未 import @typeky/editor（编辑器只属于后台 SPA）
 *   2. 站点构建产物中不含前端框架 / 编辑器运行时代码
 *
 * 尚无构建产物时跳过资产扫描，不视为失败。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const failures = []

/** 去掉注释，避免"说明文字里提到某包名"被误判为真实引用 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * 只匹配 import / export-from / require / 动态 import 的**说明符**。
 * 说明符一定被引号包裹，因此注释与普通文本不会误命中。
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

const FORBIDDEN_FOR_SITE = [/^@typeky\/editor(?:\/|$)/]

// ---- 1. 站点 Worker 不得引用编辑器包 ----
const siteSrc = join(root, 'apps/site/src')
let siteFilesScanned = 0
for (const file of walk(siteSrc)) {
  if (!/\.(ts|tsx|js|mjs)$/.test(file)) continue
  siteFilesScanned++
  for (const spec of importedSpecifiers(readFileSync(file, 'utf8'))) {
    for (const re of FORBIDDEN_FOR_SITE) {
      if (re.test(spec)) {
        failures.push(`站点 Worker 引用了禁止的包：${file} → ${spec}`)
      }
    }
  }
}

// ---- 2. 站点构建产物不得含框架 / 编辑器运行时 ----
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
      if (src.includes(sig)) failures.push(`站点资产疑似含框架代码（${sig}）：${file}`)
    }
  }
}

if (failures.length > 0) {
  console.error('\n资产边界检查失败：')
  for (const f of failures) console.error(`  ✗ ${f}`)
  process.exit(1)
}

const note =
  assetsScanned === 0
    ? '（暂无站点构建产物，已跳过资产扫描）'
    : `（扫描站点源码 ${siteFilesScanned} 个文件、构建产物 ${assetsScanned} 个文件）`
console.log(`check:boundaries — 通过 ${note}`)
