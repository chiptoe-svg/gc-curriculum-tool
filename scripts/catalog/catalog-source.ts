/**
 * Shared I/O for the catalog scripts: open the clemson-advising catalog.db
 * READ-ONLY (node:sqlite, no extra dependency) and load the app's env through
 * the app's own parser (@next/env), never a hand parse.
 *
 * The app never imports this at runtime — only scripts/catalog/*.ts do.
 */
import { createRequire } from 'node:module';
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { CatalogCourseRow, FullCatalogCourseRow } from '@/lib/catalog/catalog-sync';

export const DEFAULT_CATALOG_DB = path.join(homedir(), 'projects/clemson-advising-mcp/core/db/catalog.db');

const require = createRequire(import.meta.url);

export function loadAppEnv(root: string = process.cwd()): void {
  // @next/env is a transitive dependency (pnpm keeps it out of node_modules' top level).
  const store = path.join(root, 'node_modules/.pnpm');
  const dir = readdirSync(store).find(d => d.startsWith('@next+env@'));
  if (!dir) throw new Error('@next/env not found in node_modules/.pnpm — run pnpm install');
  const { loadEnvConfig } = require(path.join(store, dir, 'node_modules/@next/env')) as {
    loadEnvConfig: (dir: string, dev: boolean, log: { info: () => void; error: (...a: unknown[]) => void }) => unknown;
  };
  loadEnvConfig(root, false, { info: () => {}, error: console.error });
}

interface SqliteStatement { all(...params: unknown[]): unknown[] }
interface SqliteDb { prepare(sql: string): SqliteStatement; close(): void }

export function openCatalogReadOnly(dbPath: string): SqliteDb {
  if (!existsSync(dbPath)) throw new Error(`catalog DB not found: ${dbPath}`);
  // node:sqlite (Node >= 22.5). @types/node here predates it, hence the local types.
  const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string, o: { readOnly: boolean }) => SqliteDb };
  return new DatabaseSync(dbPath, { readOnly: true });
}

/** Active GC courses, plus any of `extraCodes` (our non-GC courses) the catalog has. */
export function readCatalogRows(db: SqliteDb, extraCodes: ReadonlyArray<string>): CatalogCourseRow[] {
  const placeholders = extraCodes.map(() => '?').join(', ') || "''";
  return db.prepare(
    `SELECT code, title, prereq_text, coreq_text, last_synced, source_url
       FROM course
      WHERE status = 'active' AND (subject = 'GC' OR code IN (${placeholders}))
      ORDER BY subject, number`,
  ).all(...extraCodes) as CatalogCourseRow[];
}

/**
 * EVERY course in the catalog (no subject/code filter) — the full roster
 * (access-panel addendum, 2026-10-07): ~4,085 rows, all `status = 'active'`
 * as of the 2026-10-06 sync (kept as a filter for safety against future
 * inactive rows, not because it currently excludes any).
 */
export function readAllCatalogCourses(db: SqliteDb): FullCatalogCourseRow[] {
  return db.prepare(
    `SELECT code, title, credits, description, last_synced, source_url
       FROM course
      WHERE status = 'active'
      ORDER BY subject, number`,
  ).all() as FullCatalogCourseRow[];
}

export function readCatalogYears(db: SqliteDb): Map<number, string> {
  const rows = db.prepare('SELECT catoid, label FROM catalog_year').all() as Array<{ catoid: number; label: string }>;
  return new Map(rows.map(r => [Number(r.catoid), r.label]));
}

export function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
