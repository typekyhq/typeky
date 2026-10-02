import type {
  ColumnDef,
  IndexColumnRef,
  IndexDef,
  LogicalModel,
  LogicalType,
  TableDef,
} from '@typeky/core'

/** Logical type to SQLite storage class (architecture section 5.2). */
const SQL_TYPE: Record<LogicalType, string> = {
  uuid: 'TEXT',
  text: 'TEXT',
  integer: 'INTEGER',
  boolean: 'INTEGER',
  json: 'TEXT',
  timestamp: 'TEXT',
}

const WRAP_AT = 76

function wrapText(text: string, width: number): string[] {
  const lines: string[] = []
  let current = ''

  for (const word of text.split(' ')) {
    if (current.length > 0 && current.length + word.length + 1 > width) {
      lines.push(current)
      current = word
    } else {
      current = current.length > 0 ? `${current} ${word}` : word
    }
  }

  if (current.length > 0) lines.push(current)
  return lines
}

export function renderColumnDefinition(column: ColumnDef): string {
  const parts: string[] = [SQL_TYPE[column.type]]

  if (column.primaryKey) {
    // SQLite only implies NOT NULL for INTEGER PRIMARY KEY. Every id here is
    // TEXT, so the constraint has to be spelled out or a NULL id would be
    // insertable and the row would be unreachable.
    parts.push('PRIMARY KEY', 'NOT NULL')
  } else if (column.notNull) {
    parts.push('NOT NULL')
  }

  if (column.unique) parts.push('UNIQUE')
  if (column.defaultSql !== undefined) parts.push(`DEFAULT ${column.defaultSql}`)

  if (column.references) {
    const { table, column: target, onDelete } = column.references
    const action = onDelete ? ` ON DELETE ${onDelete.toUpperCase()}` : ''
    parts.push(`REFERENCES ${table}(${target})${action}`)
  }

  return parts.join(' ')
}

function renderIndexColumn(ref: IndexColumnRef): string {
  if (typeof ref === 'string') return ref
  return `${ref.column}${ref.desc ? ' DESC' : ''}`
}

export function renderIndex(table: TableDef, index: IndexDef): string {
  const columns = index.columns.map(renderIndexColumn).join(', ')
  const where = index.where ? ` WHERE ${index.where}` : ''
  const unique = index.unique ? 'UNIQUE ' : ''
  return `CREATE ${unique}INDEX ${index.name} ON ${table.name}(${columns})${where};`
}

/**
 * One `CREATE TABLE` and the indexes that belong to it.
 *
 * Exported because an appended migration creates a table in exactly the same
 * words as the bootstrap migration does: two renderers for one table is two
 * schemas that drift.
 */
export function renderCreateTable(table: TableDef): string[] {
  const lines: string[] = [`-- ===== ${table.name} =====`]

  if (table.note) {
    for (const line of wrapText(table.note, WRAP_AT)) lines.push(`-- ${line}`)
  }

  const nameWidth = Math.max(...table.columns.map((column) => column.name.length))
  const body: Array<{ text: string; note?: string }> = table.columns.map((column) => ({
    text: `${column.name.padEnd(nameWidth)} ${renderColumnDefinition(column)}`,
    note: column.note,
  }))

  for (const unique of table.uniques ?? []) {
    body.push({ text: `UNIQUE (${unique.columns.join(', ')})` })
  }

  const width = Math.max(
    ...body.map((entry, index) => entry.text.length + (index === body.length - 1 ? 0 : 1)),
  )

  lines.push(`CREATE TABLE ${table.name} (`)
  body.forEach((entry, index) => {
    const withComma = `${entry.text}${index === body.length - 1 ? '' : ','}`
    const padded = entry.note ? withComma.padEnd(width) : withComma
    const note = entry.note ? `  -- ${entry.note}` : ''
    lines.push(`  ${padded}${note}`)
  })
  lines.push(');')

  for (const index of table.indexes ?? []) {
    lines.push(renderIndex(table, index))
  }

  return lines
}

const HEADER = [
  '-- The whole schema, rendered from packages/core/src/model/schema.ts.',
  '--',
  '-- This is not a migration file. It is used to build a database that matches the',
  '-- model -- the repository tests do exactly that -- and the first migration',
  '-- (`0001_init.sql`) was written from it once and frozen. Changes since then are',
  '-- appended as numbered migrations by `pnpm db:generate`.',
].join('\n')

/**
 * Renders the full DDL for the logical model. Tables are emitted in model
 * order, which guarantees every referenced table is declared first.
 */
export function renderMigrationSql(model: LogicalModel): string {
  const blocks = model.tables.map((table) => renderCreateTable(table).join('\n'))
  return `${HEADER}\n\n${blocks.join('\n\n')}\n`
}
