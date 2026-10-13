// @vitest-environment node
// Fix round 1 (Important #1, hostile review 2026-10-12): pins every
// Drizzle-declared constraint name for the six P1 tables in
// lib/db/schema.ts against what Postgres actually assigned on the applied
// scratch (`pg_constraint`) — catches exactly the kind of drift the review
// found by hand (four names that didn't match: the rated-consistency CHECK
// and three FKs). Gated isP1MainDb(): this needs 0058 ALREADY applied for
// real, so it must run against the main scratch, never the pre clone
// (which stays pre-0058 forever for the migration-rehearsal suite).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  careerTargetOccupations,
  onetRelease,
  onetOccupations,
  onetElementRatings,
  onetTaskStatements,
  onetTaskRatings,
} from '@/lib/db/schema';
import { isP1MainDb } from './p1/scratch-guard';

const RUN = isP1MainDb();

const TABLES: Record<string, PgTable> = {
  career_target_occupations: careerTargetOccupations,
  onet_release: onetRelease,
  onet_occupations: onetOccupations,
  onet_element_ratings: onetElementRatings,
  onet_task_statements: onetTaskStatements,
  onet_task_ratings: onetTaskRatings,
};

/**
 * Every constraint name Drizzle's own schema object would assign to this
 * table: named checks (check() always requires a name), named
 * foreignKeys/primaryKeys/uniqueConstraints built through their builder
 * functions (getName() falls back to Drizzle's OWN default-naming
 * convention when unnamed — which does NOT match Postgres's default, so
 * every P1 foreignKey()/primaryKey() call is given an explicit name on
 * purpose), plus the Postgres-assigned default for a single-column inline
 * `.primaryKey()` column (no Drizzle constraint object exists for that one
 * at all — Postgres names it `<table>_pkey` itself from unnamed SQL,
 * exactly as 0058's hand-written migration leaves it).
 */
function expectedConstraintNames(tableName: string, table: PgTable): Set<string> {
  const cfg = getTableConfig(table);
  const names = new Set<string>();
  for (const c of cfg.checks) names.add(c.name);
  for (const fk of cfg.foreignKeys) names.add(fk.getName());
  for (const uq of cfg.uniqueConstraints) {
    const n = uq.getName();
    if (n) names.add(n);
  }
  for (const pk of cfg.primaryKeys) names.add(pk.getName());
  if (cfg.columns.some((c) => c.primary)) names.add(`${tableName}_pkey`);
  return names;
}

describe.skipIf(!RUN)('P1 Drizzle constraint names match pg_constraint on the applied scratch (fix round 1)', () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool.end();
  });

  async function actualConstraintNames(tableName: string): Promise<string[]> {
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT con.conname
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = 'public' AND rel.relname = $1`,
      [tableName],
    );
    return rows.map((r) => r.conname);
  }

  for (const [tableName, table] of Object.entries(TABLES)) {
    it(`${tableName}: every Drizzle constraint name matches pg_constraint`, async () => {
      const expected = [...expectedConstraintNames(tableName, table)].sort();
      const actual = (await actualConstraintNames(tableName)).sort();
      expect(expected, `${tableName} has no constraints recorded on either side — the comparison would be vacuous`).not.toEqual([]);
      expect(expected).toEqual(actual);
    });
  }

  // Red-proof (fix round 1): proves this comparison technique actually
  // fails on a name mismatch, the same way it would have failed on this
  // schema before the fix (confirmed by hand: reverting the four renamed
  // constraints and re-running this file reproduced exactly 4 failures,
  // then was restored — see the task report for the transcript).
  it('red-proof: the comparison fails when the expected set has a wrong name', async () => {
    const actual = (await actualConstraintNames('onet_release')).sort();
    const corrupted = ['onet_release_pkey_WRONG_NAME'].sort();
    expect(() => expect(corrupted).toEqual(actual)).toThrow();
  });
});
