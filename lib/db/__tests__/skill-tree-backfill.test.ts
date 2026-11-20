/**
 * Runs only against the scratch database (skips anywhere else). Applies 0074 INSIDE a transaction it always rolls
 * back, so the scratch DB is left unchanged and the test is repeatable; competency_levels is snapshotted into a temp
 * table before the apply and compared after, inside the same transaction.
 *
 * Reproduction (the scratch DB lags live: it needs 0072 and 0073 once, before this test can pass):
 *   export DATABASE_URL="$(node -e "process.loadEnvFile('.env.local');process.stdout.write(process.env.DATABASE_URL.replace(/\/gc_curriculum(\?|$)/,'/gc_curriculum_builder_scratch\$1'))")"
 *   P=/Applications/Postgres.app/Contents/Versions/17/bin/psql
 *   $P "$DATABASE_URL" -Atc 'select current_database()'      # must print gc_curriculum_builder_scratch
 *   $P "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0072_competency_levels.sql   # only if competency_levels is missing
 *   $P "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/0073_app_settings.sql        # only if app_settings is missing
 *   pnpm vitest run lib/db/__tests__/skill-tree-backfill.test.ts
 * (0074 itself is NOT applied permanently; if it already is in the scratch DB, the test fails on its own guard.)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { Pool, type PoolClient } from 'pg';

try { process.loadEnvFile('.env.local'); } catch { /* no .env.local: the suite skips */ }
const SCRATCH = /\/gc_curriculum_builder_scratch(\?|$)/.test(process.env.DATABASE_URL ?? '');

// The file is one BEGIN ... COMMIT transaction; run its body inside the test's own transaction.
const body = readFileSync('drizzle/0074_skill_tree.sql', 'utf8').replace(/^BEGIN;$/m, '').replace(/^COMMIT;$/m, '');

describe.skipIf(!SCRATCH)('migration 0074 backfill (scratch database, rolled back)', () => {
  let pool: Pool;
  let c: PoolClient;
  const one = async (sql: string) => Number((await c.query(sql)).rows[0].n);
  const LEVELS = 'select * from competency_levels';

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    c = await pool.connect();
    expect((await c.query('select current_database() d')).rows[0].d).toBe('gc_curriculum_builder_scratch');
    await c.query('BEGIN');
    await c.query(`create temp table levels_before on commit drop as ${LEVELS}`);
    await c.query(body);
  });
  afterAll(async () => {
    await c.query('ROLLBACK');
    c.release();
    await pool.end();
  });

  it('has one master per catalog competency', async () => {
    expect(await one('select count(*)::int n from skill_nodes where competency_id is not null'))
      .toBe(await one('select count(*)::int n from sub_competencies'));
    expect(await one('select count(*)::int n from skill_nodes')).toBe(await one('select count(*)::int n from sub_competencies'));
  });
  it('has one leaf per distinct (course, skill, competency) over live snapshots', async () => {
    const expected = await one(`select count(*)::int n from (select distinct s.course_code, l.skill_ref, l.competency_id
      from skill_competency_links l join course_capture_snapshots s on s.id = l.snapshot_id where s.retired_at is null) x`);
    expect(expected).toBeGreaterThan(0);
    expect(await one('select count(*)::int n from skill_leaves')).toBe(expected);
  });
  it('logs one migrated event with the counts', async () => {
    const r = (await c.query(`select after from skill_tree_events where kind = 'migrated'`)).rows;
    expect(r).toHaveLength(1);
    expect(r[0].after.leaves).toBe(await one('select count(*)::int n from skill_leaves'));
  });
  it('leaves competency_levels identical before and after', async () => {
    expect(await one('select count(*)::int n from levels_before')).toBeGreaterThan(0);
    expect(await one(`select count(*)::int n from (select * from levels_before except ${LEVELS}) x`)).toBe(0);
    expect(await one(`select count(*)::int n from (${LEVELS} except select * from levels_before) x`)).toBe(0);
  });
  it('refuses a second apply', async () => {
    await c.query('SAVEPOINT again');
    await expect(c.query(body)).rejects.toThrow('0074: already applied');
    await c.query('ROLLBACK TO SAVEPOINT again');
  });
});
