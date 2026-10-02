import type { ColumnDef, IndexDef, LogicalModel, TableDef } from '@typeky/core'

/**
 * What changed between two models, as the statements a database can run.
 *
 * SQLite can create a table, drop a table, add a column, drop a column and create
 * or drop an index. It cannot change a column in place -- a different type, a
 * `NOT NULL`, a new reference -- and it cannot add or remove a table-level
 * `UNIQUE`; each of those needs the documented twelve-step rebuild, which is
 * "create a new table, copy the rows, drop the old one, rename". That is a
 * migration only a person can write, because only a person knows what the old
 * rows mean in the new shape.
 *
 * So this reports those as `unsupported` rather than guessing. A generator that
 * silently dropped and recreated a table would lose data on the first schema
 * change that mattered, and it would do it quietly.
 */

export type ModelChange =
  | { kind: 'drop_index'; index: string }
  | { kind: 'drop_table'; table: string }
  | { kind: 'drop_column'; table: string; column: string }
  | { kind: 'add_column'; table: string; column: ColumnDef }
  | { kind: 'create_table'; table: TableDef }
  | { kind: 'create_index'; table: TableDef; index: IndexDef }

export interface ModelDiff {
  /** In the order they have to run: drops, then columns, then creates. */
  changes: ModelChange[]
  /** What cannot be applied in place, each described for a hand-written migration. */
  unsupported: string[]
}

function byName<T extends { name: string }>(items: readonly T[]): Map<string, T> {
  return new Map(items.map((item) => [item.name, item]))
}

/**
 * Everything the model says about a column except how it is documented.
 *
 * `note` is left out on purpose: it is a comment in generated DDL, not a fact
 * about the stored data, and a reworded comment is not a migration.
 */
function columnShape(column: ColumnDef): string {
  return JSON.stringify([
    column.type,
    column.notNull ?? false,
    column.primaryKey ?? false,
    column.unique ?? false,
    column.defaultSql ?? null,
    column.references ?? null,
  ])
}

function indexShape(index: IndexDef): string {
  return JSON.stringify([index.columns, index.unique ?? false, index.where ?? null])
}

export function diffModels(previous: LogicalModel, next: LogicalModel): ModelDiff {
  const changes: ModelChange[] = []
  const unsupported: string[] = []

  const was = byName(previous.tables)
  const is = byName(next.tables)

  // Phase one: what goes away. A dropped table takes its indexes with it, so those
  // are not dropped separately -- and dropping an index first is what keeps an
  // index over a dropped column from blocking it.
  for (const table of previous.tables) {
    if (!is.has(table.name)) {
      changes.push({ kind: 'drop_table', table: table.name })
      continue
    }

    const nextTable = is.get(table.name)
    if (nextTable === undefined) continue

    const indexesNext = byName(nextTable.indexes ?? [])
    for (const index of table.indexes ?? []) {
      if (!indexesNext.has(index.name)) changes.push({ kind: 'drop_index', index: index.name })
    }
  }

  // Phase two: the shape of a table that stays.
  for (const table of next.tables) {
    const old = was.get(table.name)

    if (old === undefined) {
      changes.push({ kind: 'create_table', table })
      continue
    }

    const columnsOld = byName(old.columns)
    const columnsNext = byName(table.columns)

    for (const column of old.columns) {
      if (!columnsNext.has(column.name)) {
        changes.push({ kind: 'drop_column', table: table.name, column: column.name })
      }
    }

    for (const column of table.columns) {
      const previousColumn = columnsOld.get(column.name)
      if (previousColumn === undefined) {
        // SQLite's `ALTER TABLE ADD COLUMN` refuses a NOT NULL column with no
        // default, and refuses PRIMARY KEY or UNIQUE outright. Saying so here is
        // better than emitting SQL that fails halfway through a deploy.
        if (column.notNull === true && column.defaultSql === undefined) {
          unsupported.push(
            `${table.name}.${column.name}: a NOT NULL column with no default cannot be added in place; give it a default, or write the rebuild by hand`,
          )
          continue
        }
        if (column.primaryKey === true || column.unique === true) {
          unsupported.push(
            `${table.name}.${column.name}: SQLite cannot add a PRIMARY KEY or UNIQUE column in place`,
          )
          continue
        }

        changes.push({ kind: 'add_column', table: table.name, column })
        continue
      }

      if (columnShape(previousColumn) !== columnShape(column)) {
        unsupported.push(
          `${table.name}.${column.name}: changing a column needs a table rebuild`,
        )
      }
    }

    const uniques = (defs: TableDef['uniques']): string[] =>
      (defs ?? []).map((unique) => unique.columns.join(', ')).sort()

    if (JSON.stringify(uniques(old.uniques)) !== JSON.stringify(uniques(table.uniques))) {
      unsupported.push(
        `${table.name}: adding or removing a table-level UNIQUE needs a table rebuild`,
      )
    }
  }

  // Phase three: what is new. Indexes on a new table were already emitted with it.
  for (const table of next.tables) {
    const old = was.get(table.name)
    if (old === undefined) continue

    const indexesOld = byName(old.indexes ?? [])
    for (const index of table.indexes ?? []) {
      const previousIndex = indexesOld.get(index.name)
      if (previousIndex === undefined) {
        changes.push({ kind: 'create_index', table, index })
      } else if (indexShape(previousIndex) !== indexShape(index)) {
        // An index has no rows of its own, so replacing one is a drop and a create
        // rather than a rebuild -- unlike a table-level UNIQUE, it holds no state.
        changes.push({ kind: 'drop_index', index: index.name })
        changes.push({ kind: 'create_index', table, index })
      }
    }
  }

  return { changes, unsupported }
}

/**
 * A file name for a migration, from what it does.
 *
 * Deterministic, because the same model has to produce the same file name every
 * time: the name is what wrangler records as applied, and a generator that could
 * name it differently on two machines is a migration that gets applied twice.
 */
export function migrationSlug(diff: ModelDiff): string {
  const tokens: string[] = []

  const add = (token: string): void => {
    if (!tokens.includes(token)) tokens.push(token)
  }

  for (const change of diff.changes) {
    switch (change.kind) {
      case 'create_table':
        add(change.table.name)
        break
      case 'drop_table':
        add(`drop_${change.table}`)
        break
      case 'add_column':
        add(`${change.table}_${change.column.name}`)
        break
      case 'drop_column':
        add(`drop_${change.table}_${change.column}`)
        break
      // Index changes travel with the column or table that caused them, so naming
      // them too would only make the name longer than it has to be.
      case 'create_index':
      case 'drop_index':
        break
    }
  }

  return tokens.join('_').slice(0, 60) || 'schema'
}
