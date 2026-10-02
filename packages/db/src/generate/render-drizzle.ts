import type { ColumnDef, IndexColumnRef, LogicalModel, LogicalType, TableDef } from '@typeky/core'

/**
 * snake_case column name to camelCase TypeScript property name.
 * `logo_media_id` becomes `logoMediaId`.
 */
function toIdentifier(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_match, char: string) => char.toUpperCase())
}

function isNumeric(type: LogicalType): boolean {
  return type === 'integer' || type === 'boolean'
}

function renderDefault(column: ColumnDef): string {
  // Column defaults are raw SQL literals. Booleans are 0 and 1, which are valid
  // integer defaults, because the columns themselves stay raw (no drizzle mode).
  return column.defaultSql as string
}

function renderColumn(table: TableDef, column: ColumnDef): string {
  let expression = isNumeric(column.type)
    ? `integer('${column.name}')`
    : `text('${column.name}')`

  if (column.primaryKey) expression += '.primaryKey()'
  else if (column.notNull) expression += '.notNull()'

  if (column.unique) expression += '.unique()'
  if (column.defaultSql !== undefined) expression += `.default(${renderDefault(column)})`

  // A self-reference is emitted as a table-level `foreignKey` instead, in
  // `renderExtras`. Drizzle's column form takes a thunk that closes over the
  // table being defined, and TypeScript cannot infer it -- `terms.parentId`
  // referring to `terms.id` is a type that depends on itself.
  if (column.references && column.references.table !== table.name) {
    const { table: target, column: targetColumn, onDelete } = column.references
    const targetExpression = `${toIdentifier(target)}.${toIdentifier(targetColumn)}`
    expression += onDelete
      ? `.references(() => ${targetExpression}, { onDelete: '${onDelete}' })`
      : `.references(() => ${targetExpression})`
  }

  return `  ${toIdentifier(column.name)}: ${expression},`
}

function renderIndexColumn(ref: IndexColumnRef): string {
  if (typeof ref === 'string') return `t.${toIdentifier(ref)}`
  return ref.desc ? 'sql`${t.' + toIdentifier(ref.column) + '} DESC`' : `t.${toIdentifier(ref.column)}`
}

function renderExtras(table: TableDef): string {
  const entries: string[] = []

  for (const index of table.indexes ?? []) {
    const builder = index.unique ? `uniqueIndex('${index.name}')` : `index('${index.name}')`
    const columns = index.columns.map(renderIndexColumn).join(', ')
    const where = index.where ? '.where(sql`' + index.where + '`)' : ''
    entries.push(`  ${builder}.on(${columns})${where},`)
  }

  for (const column of table.columns) {
    const reference = column.references
    if (reference === undefined || reference.table !== table.name) continue

    const onDelete = reference.onDelete ? `.onDelete('${reference.onDelete}')` : ''
    entries.push(
      `  foreignKey({ columns: [t.${toIdentifier(column.name)}], foreignColumns: [t.${toIdentifier(reference.column)}] })${onDelete},`,
    )
  }

  for (const unique of table.uniques ?? []) {
    const columns = unique.columns.map((column) => `t.${toIdentifier(column)}`).join(', ')
    entries.push(`  unique().on(${columns}),`)
  }

  return entries.length > 0 ? `, (t) => [\n${entries.join('\n')}\n]` : ''
}

const HEADER = [
  '// GENERATED FILE -- do not edit by hand.',
  '// Source of truth: packages/core/src/model/schema.ts',
  '// Regenerate with `pnpm db:generate`; `pnpm check:schema-drift` fails when this',
  '// file and the model disagree.',
  '//',
  '// Columns use raw SQLite types on purpose. Every value conversion -- JSON,',
  '// booleans, timestamps -- goes through the codec in @typeky/core, which is the',
  '// only read and write path for stored values (architecture section 5.2).',
].join('\n')

/**
 * Renders the Drizzle schema for the logical model. Tables are emitted in model
 * order, which guarantees every referenced table is declared first.
 */
export function renderDrizzleSchema(model: LogicalModel): string {
  const indexes = model.tables.flatMap((table) => table.indexes ?? [])
  const usesIndex = indexes.some((index) => !index.unique)
  const usesUniqueIndex = indexes.some((index) => index.unique)
  const usesUnique = model.tables.some((table) => (table.uniques?.length ?? 0) > 0)
  const usesSql = indexes.some(
    (index) =>
      index.where !== undefined ||
      index.columns.some((column) => typeof column !== 'string' && column.desc === true),
  )

  const usesForeignKey = model.tables.some((table) =>
    table.columns.some((column) => column.references?.table === table.name),
  )

  const imports: string[] = []
  if (usesForeignKey) imports.push('foreignKey')
  if (usesIndex) imports.push('index')
  imports.push('integer')
  imports.push('sqliteTable')
  imports.push('text')
  if (usesUnique) imports.push('unique')
  if (usesUniqueIndex) imports.push('uniqueIndex')

  const header = `import { ${imports.join(', ')} } from 'drizzle-orm/sqlite-core'`
  const sqlImport = usesSql ? "\nimport { sql } from 'drizzle-orm'" : ''

  const blocks = model.tables.map((table) => {
    const columns = table.columns.map((column) => renderColumn(table, column)).join('\n')
    return `export const ${toIdentifier(table.name)} = sqliteTable('${table.name}', {\n${columns}\n}${renderExtras(table)})`
  })

  return `${HEADER}\n\n${header}${sqlImport}\n\n${blocks.join('\n\n')}\n`
}
