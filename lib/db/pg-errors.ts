/** Postgres undefined_table (42P01), anywhere in the cause chain: a migration not applied on this database. */
export function isUndefinedTable(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === '42P01') return true;
  }
  return false;
}

/** Postgres undefined_column (42703), anywhere in the cause chain: a column from a migration not applied on this database. */
export function isUndefinedColumn(err: unknown): boolean {
  for (let e: unknown = err, i = 0; e && i < 5; e = (e as { cause?: unknown }).cause, i++) {
    if ((e as { code?: unknown }).code === '42703') return true;
  }
  return false;
}
