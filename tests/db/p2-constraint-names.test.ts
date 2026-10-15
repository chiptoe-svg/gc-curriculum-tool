// @vitest-environment node
// Pins every Drizzle-declared constraint name for the eight P2 tables in
// lib/db/schema.ts against what Postgres actually assigned on the applied
// scratch (`pg_constraint`) — same technique as P1's fix round 1
// (tests/db/p1-constraint-names.test.ts), applied up front this time so 0059
// and its Drizzle schema can never drift silently. Gated isP2ScratchDb():
// this needs 0059 ALREADY applied for real, so it must run against the main
// scratch, never the pre clone (which stays pre-0059 forever for the
// migration-rehearsal suite).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { getTableConfig } from 'drizzle-orm/pg-core';
import type { PgTable } from 'drizzle-orm/pg-core';
import {
  bundleCards,
  itemEmbeddings,
  onetElementDefinitions,
  bundleMappingRuns,
  bundleMembers,
  bundleMappingOutcomes,
  bundleGoldenSamples,
  bundleGoldenPicks,
} from '@/lib/db/schema';
import { isP2ScratchDb } from './p2/scratch-guard';

const RUN = isP2ScratchDb();

const TABLES: Record<string, PgTable> = {
  bundle_cards: bundleCards,
  item_embeddings: itemEmbeddings,
  onet_element_definitions: onetElementDefinitions,
  bundle_mapping_runs: bundleMappingRuns,
  bundle_members: bundleMembers,
  bundle_mapping_outcomes: bundleMappingOutcomes,
  bundle_golden_samples: bundleGoldenSamples,
  bundle_golden_picks: bundleGoldenPicks,
};

/**
 * Every constraint name Drizzle's own schema object would assign to this
 * table: named checks (check() always requires a name), named
 * foreignKeys/primaryKeys/uniqueConstraints built through their builder
 * functions (getName() falls back to Drizzle's OWN default-naming
 * convention when unnamed — which does NOT match Postgres's default, so
 * every P2 foreignKey()/primaryKey()/unique() call is given an explicit
 * name on purpose), plus the Postgres-assigned default for a
 * multi-column inline primary key (no Drizzle constraint object exists for
 * bundle_mapping_outcomes/onet_element_definitions's composite PK — they're
 * declared via the builder's primaryKey() helper, which IS given an
 * explicit name here).
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

describe.skipIf(!RUN)('P2 Drizzle constraint names match pg_constraint on the applied scratch', () => {
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

  // Red-proof: proves this comparison technique actually fails on a name
  // mismatch (same technique P1's fix round 1 validated).
  it('red-proof: the comparison fails when the expected set has a wrong name', async () => {
    const actual = (await actualConstraintNames('bundle_cards')).sort();
    const corrupted = ['bundle_cards_pkey_WRONG_NAME'].sort();
    expect(() => expect(corrupted).toEqual(actual)).toThrow();
  });
});
