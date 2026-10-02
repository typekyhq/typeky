import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { model, type Block, type LogicalType, type TableDef } from '@typeky/core'
import { repoRoot } from './paths'

/**
 * Demo data for a fresh local database: one site, one page, one post, one
 * product, plus the two media rows the content points at.
 *
 * Ids are fixed and timestamps are constant so re-running is idempotent and the
 * output is reproducible.
 */

const SEEDED_AT = '2026-01-01T00:00:00.000Z'

const MEDIA_LOGO = '01930000-0000-7000-8000-0000000000a1'
const MEDIA_COVER = '01930000-0000-7000-8000-0000000000a2'
const PAGE_HOME = '01930000-0000-7000-8000-0000000000b1'
const POST_HELLO = '01930000-0000-7000-8000-0000000000c1'
const PRODUCT_STARTER = '01930000-0000-7000-8000-0000000000d1'
const VOCABULARY_CATEGORIES = '01930000-0000-7000-8000-0000000000e1'
const TERM_NEWS = '01930000-0000-7000-8000-0000000000f1'
const TERM_GUIDES = '01930000-0000-7000-8000-0000000000f2'
const TERM_HOWTO = '01930000-0000-7000-8000-0000000000f3'
const POST_TERM = '01930000-0000-7000-8000-000000000101'
const PRODUCT_TERM = '01930000-0000-7000-8000-000000000102'

/**
 * Demo bodies, in the real Block JSON shape (architecture section 3.11).
 *
 * Typed as `Block[]` so a change to the block model is a compile error here
 * rather than demo content that quietly stops matching the schema.
 */
const pageBlocks: Block[] = [
  {
    type: 'paragraph',
    content: [
      {
        type: 'text',
        text: 'Typeky builds personal blogs, business sites and niche sites on a single Cloudflare account.',
      },
    ],
  },
]

const postBlocks: Block[] = [
  {
    type: 'paragraph',
    content: [{ type: 'text', text: 'This post exists so the blog list has something to show.' }],
  },
  {
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Edit or delete it from the admin, or replace it with your own writing.' },
    ],
  },
]

const productBlocks: Block[] = [
  {
    type: 'paragraph',
    content: [{ type: 'text', text: 'A showcase product. Prices are display labels, not a checkout.' }],
  },
]

const rows: Record<string, Array<Record<string, unknown>>> = {
  media: [
    {
      id: MEDIA_LOGO,
      filename: 'typeky-logo.svg',
      storage_key: 'seed/typeky-logo.svg',
      mime_type: 'image/svg+xml',
      byte_size: 2048,
      width: 240,
      height: 64,
      alt_text: 'Typeky',
      created_at: SEEDED_AT,
    },
    {
      id: MEDIA_COVER,
      filename: 'hello-typeky.jpg',
      storage_key: 'seed/hello-typeky.jpg',
      mime_type: 'image/jpeg',
      byte_size: 184320,
      width: 1600,
      height: 900,
      alt_text: 'A desk with a laptop showing the Typeky admin',
      created_at: SEEDED_AT,
    },
  ],
  sites: [
    {
      id: 'default',
      name: 'Typeky Demo',
      tagline: 'A small site showing all three content types',
      logo_media_id: MEDIA_LOGO,
      theme: 'default',
      settings: {
        accentColor: '#111827',
        socialLinks: [{ label: 'GitHub', href: 'https://github.com/typekyhq/typeky' }],
        seo: { defaultTitle: 'Typeky Demo', defaultDescription: 'A demo site built with Typeky.' },
        footer: 'Built with Typeky.',
      },
      nav: [
        { label: 'Home', href: '/', order: 0 },
        { label: 'Blog', href: '/posts', order: 1 },
        { label: 'Products', href: '/products', order: 2 },
      ],
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
    },
  ],
  pages: [
    {
      id: PAGE_HOME,
      title: 'Home',
      slug: 'home',
      content_blocks: pageBlocks,
      seo_metadata: { title: 'Typeky Demo', description: 'A demo site built with Typeky.' },
      status: 'published',
      is_home: true,
      sort_order: 0,
      revision: 1,
      published_at: SEEDED_AT,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
    },
  ],
  posts: [
    {
      id: POST_HELLO,
      title: 'Hello Typeky',
      slug: 'hello-typeky',
      excerpt: 'The first post on a freshly seeded site.',
      cover_media_id: MEDIA_COVER,
      content_blocks: postBlocks,
      tags: ['getting-started'],
      seo_metadata: { title: 'Hello Typeky', description: 'The first post on a freshly seeded site.' },
      status: 'published',
      revision: 1,
      published_at: SEEDED_AT,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
    },
  ],
  products: [
    {
      id: PRODUCT_STARTER,
      title: 'Starter Widget',
      slug: 'starter-widget',
      summary: 'A showcase product with a gallery, specs and an outbound link.',
      content_blocks: productBlocks,
      cover_media_id: MEDIA_COVER,
      gallery: [MEDIA_COVER],
      specs: [
        { label: 'Material', value: 'Recycled aluminium' },
        { label: 'Warranty', value: '2 years' },
      ],
      price_label: 'From 199 USD',
      cta_label: 'Talk to us',
      cta_url: 'https://example.com/contact',
      seo_metadata: { title: 'Starter Widget' },
      status: 'published',
      sort_order: 0,
      revision: 1,
      published_at: SEEDED_AT,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
    },
  ],
  // A vocabulary that applies to both content types, with a nested term, so a
  // seeded site shows what a taxonomy is for rather than an empty picker.
  vocabularies: [
    {
      id: VOCABULARY_CATEGORIES,
      name: 'Categories',
      description: 'What posts and products are filed under.',
      content_types: ['post', 'product'],
      sort_order: 0,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
    },
  ],
  terms: [
    {
      id: TERM_NEWS,
      vocabulary_id: VOCABULARY_CATEGORIES,
      parent_id: null,
      name: 'News',
      slug: 'news',
      description: null,
      sort_order: 0,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
    },
    {
      id: TERM_GUIDES,
      vocabulary_id: VOCABULARY_CATEGORIES,
      parent_id: null,
      name: 'Guides',
      slug: 'guides',
      description: null,
      sort_order: 1,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
    },
    {
      id: TERM_HOWTO,
      vocabulary_id: VOCABULARY_CATEGORIES,
      parent_id: TERM_GUIDES,
      name: 'How-to',
      slug: 'how-to',
      description: null,
      sort_order: 0,
      created_at: SEEDED_AT,
      updated_at: SEEDED_AT,
    },
  ],
  content_terms: [
    { id: POST_TERM, content_type: 'post', content_id: POST_HELLO, term_id: TERM_NEWS },
    { id: PRODUCT_TERM, content_type: 'product', content_id: PRODUCT_STARTER, term_id: TERM_GUIDES },
  ],
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function toSqlLiteral(type: LogicalType, value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  switch (type) {
    case 'integer':
      return String(value)
    case 'boolean':
      return value ? '1' : '0'
    case 'json':
      return quote(JSON.stringify(value))
    default:
      return quote(String(value))
  }
}

/**
 * Fails loudly when a fixture stops matching the model, so adding a column
 * forces the demo data to be reconsidered instead of silently defaulting.
 */
function assertFixturesMatchModel(): void {
  for (const [tableName, tableRows] of Object.entries(rows)) {
    const table = model.tables.find((candidate) => candidate.name === tableName)
    if (!table) throw new Error(`seed fixture references unknown table: ${tableName}`)

    const declared = table.columns.map((column) => column.name)
    for (const row of tableRows) {
      const missing = declared.filter((name) => !(name in row))
      if (missing.length > 0) {
        throw new Error(`${tableName}: fixture is missing columns: ${missing.join(', ')}`)
      }
      const unknown = Object.keys(row).filter((name) => !declared.includes(name))
      if (unknown.length > 0) {
        throw new Error(`${tableName}: fixture has columns the model does not declare: ${unknown.join(', ')}`)
      }
    }
  }
}

/** Upsert rather than replace, so re-seeding never nulls a foreign key. */
function renderUpsert(table: TableDef, row: Record<string, unknown>): string {
  const columns = table.columns.map((column) => column.name)
  const values = table.columns.map((column) => toSqlLiteral(column.type, row[column.name]))
  const assignments = columns
    .filter((name) => name !== 'id')
    .map((name) => `${name} = excluded.${name}`)

  return [
    `INSERT INTO ${table.name} (${columns.join(', ')})`,
    `VALUES (${values.join(', ')})`,
    `ON CONFLICT(id) DO UPDATE SET ${assignments.join(', ')};`,
  ].join('\n')
}

function renderSeedSql(): string {
  const header = [
    '-- Generated by packages/db/scripts/seed.ts -- do not edit by hand.',
    '-- Idempotent: re-running updates the same rows instead of duplicating them.',
  ]
  const statements = model.tables
    .filter((table) => (rows[table.name]?.length ?? 0) > 0)
    .flatMap((table) => rows[table.name]!.map((row) => renderUpsert(table, row)))

  return `${header.join('\n')}\n\n${statements.join('\n\n')}\n`
}

function runWrangler(args: string[], capture = false) {
  const wrangler = resolve(repoRoot, 'node_modules/.bin/wrangler')
  const command = ['d1', 'execute', 'DB', '--local', '--config', 'apps/site/wrangler.jsonc', ...args]

  return spawnSync(wrangler, command, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })
}

/** Wrangler prints one JSON entry per statement when stdout is not a TTY. */
function parseStatementResults(
  stdout: string,
): Array<{ results?: Array<Record<string, number>> }> | undefined {
  try {
    const payload: unknown = JSON.parse(stdout)
    return Array.isArray(payload) ? payload : undefined
  } catch {
    return undefined
  }
}

assertFixturesMatchModel()

const directory = mkdtempSync(join(tmpdir(), 'typeky-seed-'))
const sqlPath = join(directory, 'seed.sql')
writeFileSync(sqlPath, renderSeedSql(), 'utf8')
console.log(`  seed sql: ${sqlPath}`)

const seeded = runWrangler(['--yes', '--json', '--file', sqlPath], true)
if (seeded.status !== 0) {
  console.error(seeded.stdout)
  console.error(seeded.stderr)
  console.error('  seed failed: is the migration applied and the D1 binding configured?')
  process.exit(seeded.status ?? 1)
}

const statements = parseStatementResults(seeded.stdout)
console.log(`  applied ${statements?.length ?? '?'} upserts from the model`)

const counts = runWrangler(
  [
    '--json',
    '--command',
    'SELECT (SELECT count(*) FROM pages) AS pages, (SELECT count(*) FROM posts) AS posts, (SELECT count(*) FROM products) AS products',
  ],
  true,
)

if (counts.status !== 0) {
  console.error(counts.stderr)
  process.exit(counts.status ?? 1)
}

const result = parseStatementResults(counts.stdout)?.[0]?.results?.[0]
if (!result) {
  console.error('  could not read the verification query output:')
  console.error(counts.stdout)
  process.exit(1)
}

console.log(`  pages=${result.pages} posts=${result.posts} products=${result.products}`)
console.log('  ok')

