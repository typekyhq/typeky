import type { LogicalModel } from '@typeky/core'
import { renderCreateTable, renderColumnDefinition, renderIndex } from './render-sql'
import type { ModelDiff } from './diff'

/**
 * A `ModelDiff` as the SQL of an appended migration.
 *
 * Each statement is emitted with the reason it is there, because a migration file
 * is read years later by someone deciding whether it is safe to run again. The
 * statements are already in the order they have to run -- `diff.ts` decides that,
 * not this.
 */
export function renderDiffSql(diff: ModelDiff, model: LogicalModel): string {
  const header = [
    '-- An appended migration, generated from packages/core/src/model/schema.ts.',
    '-- Do not edit by hand; write a new migration instead.',
    '--',
    '-- SQLite applies one statement at a time and has no transactional DDL, so each',
    '-- statement below is on its own: a failure halfway leaves the earlier ones',
    '-- applied. `pnpm db:generate` refuses changes that cannot be expressed this way',
    '-- rather than rebuilding a table, because dropping a table loses its rows.',
    '--',
    `-- Tables in the model when this was written: ${model.tables.length}.`,
  ].join('\n')

  const lines: string[] = []

  for (const change of diff.changes) {
    switch (change.kind) {
      case 'drop_index':
        lines.push(`DROP INDEX ${change.index};`)
        break
      case 'drop_table':
        lines.push(`-- Dropped from the model; its rows and its indexes go with it.`)
        lines.push(`DROP TABLE ${change.table};`)
        break
      case 'drop_column':
        lines.push(`-- Dropped from the model. This deletes the column's values.`)
        lines.push(`ALTER TABLE ${change.table} DROP COLUMN ${change.column};`)
        break
      case 'add_column':
        lines.push(
          `ALTER TABLE ${change.table} ADD COLUMN ${change.column.name} ${renderColumnDefinition(change.column)};`,
        )
        break
      case 'create_table':
        lines.push(...renderCreateTable(change.table))
        break
      case 'create_index':
        lines.push(renderIndex(change.table, change.index))
        break
    }
  }

  return `${header}\n\n${lines.join('\n')}\n`
}
