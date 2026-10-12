// @vitest-environment node
// Migration 0056 rehearsal on the scratch clone. Gated: scratch DB AND
// P0A_MIGRATION_TEST=1, run ALONE (it rolls the migration back and re-applies it).
// Leaves the scratch DB migrated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { isScratchDb } from './p0a/scratch-guard';

const ROOT = resolve(__dirname, '../..');
const MIGRATION = readFileSync(resolve(ROOT, 'drizzle/0056_competency_catalog_p0a.sql'), 'utf8');
const ROLLBACK = readFileSync(resolve(ROOT, 'scripts/migrations/2026-10-11-p0a-rollback.sql'), 'utf8');
const RUN = isScratchDb() && process.env.P0A_MIGRATION_TEST === '1';

const COV_COLS = `snapshot_id::text, career_target_id, sub_competency_id, k_depth, u_depth, d_depth,
  matched_competency, evidence_excerpt, confidence, rationale, model, generated_at::text`;
const STC = `SELECT ${COV_COLS} FROM snapshot_target_coverage ORDER BY 1,2,3`;
const VIEW_COV = `SELECT ${COV_COLS} FROM target_coverage ORDER BY 1,2,3`;
const SUBS = `SELECT id, career_target_id, name, know_descriptor, understand_descriptor, do_descriptor,
  display_order, retired, updated_at::text FROM sub_competencies ORDER BY id`;
const VIEW_SUBS = `SELECT id, career_target_id, name, know_descriptor, understand_descriptor, do_descriptor,
  display_order, retired, updated_at::text FROM target_sub_competencies ORDER BY id`;

// M-1 (adversarial review, 2026-10-11): a write committed between the
// post-checks and COMMIT could be lost (reviewer reproduced it with a
// pg_sleep before COMMIT). Closing the window needs a lock taken BEFORE any
// check runs, right after BEGIN — static text check, no DB needed.
describe('0056 and its rollback lock the mutated tables right after BEGIN (M-1)', () => {
  it('0056 locks snapshot_target_coverage and sub_competencies before any check', () => {
    const beginIdx = MIGRATION.indexOf('BEGIN;');
    const lockIdx = MIGRATION.indexOf('LOCK TABLE snapshot_target_coverage, sub_competencies IN SHARE ROW EXCLUSIVE MODE;');
    const firstCheckIdx = MIGRATION.indexOf('-- 1. Preconditions');
    expect(beginIdx).toBeGreaterThan(-1);
    expect(lockIdx).toBeGreaterThan(-1);
    expect(firstCheckIdx).toBeGreaterThan(-1);
    // Only comment lines may sit between BEGIN and the lock (no SQL statement).
    const between = MIGRATION.slice(beginIdx + 'BEGIN;'.length, lockIdx);
    expect(between.split('\n').every(line => line.trim() === '' || line.trim().startsWith('--'))).toBe(true);
    expect(lockIdx).toBeLessThan(firstCheckIdx);
  });

  it('the rollback locks snapshot_competency_coverage, career_target_requirements and sub_competencies before mutating anything, after confirming 0056 is applied', () => {
    const lockIdx = ROLLBACK.indexOf(
      'LOCK TABLE snapshot_competency_coverage, career_target_requirements, sub_competencies IN SHARE ROW EXCLUSIVE MODE;',
    );
    const appliedCheckIdx = ROLLBACK.indexOf("0056 is not applied");
    const firstMutationIdx = ROLLBACK.indexOf('DELETE FROM snapshot_target_coverage');
    expect(lockIdx).toBeGreaterThan(-1);
    expect(appliedCheckIdx).toBeGreaterThan(-1);
    expect(firstMutationIdx).toBeGreaterThan(-1);
    // Locked after confirming the tables exist (else LOCK itself throws a raw
    // "relation does not exist" instead of the clean message), but before any
    // other check or mutation runs.
    expect(lockIdx).toBeGreaterThan(appliedCheckIdx);
    expect(lockIdx).toBeLessThan(firstMutationIdx);
  });
});

describe.skipIf(!RUN)('migration 0056 (P0a) on the scratch clone', () => {
  let pool: Pool;
  let stcBefore: Record<string, unknown>[];
  let subsBefore: Array<Record<string, unknown> & { id: string; career_target_id: string; display_order: number }>;

  const q = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
    (await pool.query(text, params)).rows as T[];
  /** Run a BEGIN…COMMIT file on one client; on error, roll back so the client is clean. */
  const runFile = async (text: string) => {
    const c = await pool.connect();
    try {
      await c.query(text);
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  };
  const applied = async () =>
    (await q<{ r: string | null }>(`SELECT to_regclass('public.snapshot_competency_coverage')::text AS r`))[0]!.r !== null;
  const nullable = async () =>
    (await q<{ n: string }>(`SELECT is_nullable AS n FROM information_schema.columns
      WHERE table_name = 'sub_competencies' AND column_name = 'career_target_id'`))[0]!.n;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    if (await applied()) await runFile(ROLLBACK); // start from the pre-P0a shape
    stcBefore = await q(STC);
    subsBefore = await q(SUBS);
  });

  afterAll(async () => {
    if (!(await applied())) await runFile(MIGRATION); // later tasks expect a migrated scratch DB
    await pool.end();
  });

  it('applies: every coverage row carried over unchanged, one draft requirement per (target, sub-competency)', async () => {
    await runFile(MIGRATION);

    expect(await nullable()).toBe('YES');
    expect(await q(STC)).toEqual(stcBefore);                 // backup untouched
    expect(await q(VIEW_COV)).toEqual(stcBefore);            // new table + view = old rows, exactly
    const { n } = (await q<{ n: number }>(`SELECT count(*)::int AS n FROM snapshot_competency_coverage`))[0]!;
    expect(n).toBe(stcBefore.length);
    expect(await q(VIEW_SUBS)).toEqual(subsBefore);          // membership view = old rows, exactly

    const reqs = await q(`SELECT career_target_id, competency_id, horizon, weight, weight_source,
        required_k, required_u, required_d, depth_source, status, note, contributing_position_ids, display_order
      FROM career_target_requirements ORDER BY competency_id`);
    expect(reqs).toEqual(subsBefore.map(s => ({
      career_target_id: s.career_target_id,
      competency_id: s.id,
      horizon: 'entry',
      weight: null,
      weight_source: 'faculty',
      required_k: null,
      required_u: null,
      required_d: null,
      depth_source: null,
      status: 'draft',
      note: null,
      contributing_position_ids: [],
      display_order: s.display_order,
    })));
  });

  it('Drizzle reads both views', async () => {
    const { db } = await import('@/lib/db/client');
    const { targetCoverage, targetSubCompetencies } = await import('@/lib/db/schema');
    const cov = await db.select().from(targetCoverage).limit(1);
    const subs = await db.select().from(targetSubCompetencies).limit(1);
    expect(Object.keys(cov[0] ?? {}).sort()).toEqual([
      'careerTargetId', 'confidence', 'dDepth', 'evidenceExcerpt', 'generatedAt', 'kDepth',
      'matchedCompetency', 'model', 'rationale', 'snapshotId', 'subCompetencyId', 'uDepth',
    ]);
    expect(Object.keys(subs[0] ?? {}).sort()).toEqual([
      'careerTargetId', 'displayOrder', 'doDescriptor', 'id', 'knowDescriptor', 'name', 'retired',
      'understandDescriptor', 'updatedAt',
    ]);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const reqsBefore = await q(`SELECT * FROM career_target_requirements ORDER BY id`);
    await runFile(MIGRATION);
    expect(await q(VIEW_COV)).toEqual(stcBefore);
    expect(await q(`SELECT * FROM career_target_requirements ORDER BY id`)).toEqual(reqsBefore);
  });

  it('refuses to re-run once the new table has diverged from the backup (new code live)', async () => {
    const [row] = await q<{ s: string; c: string }>(
      `SELECT snapshot_id::text AS s, competency_id AS c FROM snapshot_competency_coverage ORDER BY 1,2 LIMIT 1`);
    await q(`UPDATE snapshot_competency_coverage SET generated_at = generated_at + interval '1 day'
      WHERE snapshot_id = $1::uuid AND competency_id = $2`, [row!.s, row!.c]);
    try {
      await expect(runFile(MIGRATION)).rejects.toThrow(/0056: the two coverage tables differ/);
    } finally {
      await q(`UPDATE snapshot_competency_coverage SET generated_at = generated_at - interval '1 day'
        WHERE snapshot_id = $1::uuid AND competency_id = $2`, [row!.s, row!.c]);
    }
    expect(await q(VIEW_COV)).toEqual(stcBefore);
  });

  // M-2 (adversarial review case 1c): the old guard compared only generated_at
  // + row existence, so a depth-only change with an unchanged generated_at
  // passed it — the re-run then failed later, at the post-check, with a
  // different and misleading message. The guard must compare every column.
  // try/finally: a false-positive message mismatch must still revert the row.
  it('refuses to re-run when only a depth changed and generated_at did not (M-2, case 1c)', async () => {
    const [row] = await q<{ s: string; c: string; d: number }>(
      `SELECT snapshot_id::text AS s, competency_id AS c, d_depth AS d FROM snapshot_competency_coverage ORDER BY 1,2 LIMIT 1`);
    await q(`UPDATE snapshot_competency_coverage SET d_depth = d_depth + 1
      WHERE snapshot_id = $1::uuid AND competency_id = $2`, [row!.s, row!.c]);
    try {
      await expect(runFile(MIGRATION)).rejects.toThrow(/0056: the two coverage tables differ/);
    } finally {
      await q(`UPDATE snapshot_competency_coverage SET d_depth = $3
        WHERE snapshot_id = $1::uuid AND competency_id = $2`, [row!.s, row!.c, row!.d]);
    }
    expect(await q(VIEW_COV)).toEqual(stcBefore);
  });

  it('rollback restores the pre-P0a shape exactly', async () => {
    await runFile(ROLLBACK);
    expect(await applied()).toBe(false);
    expect(await nullable()).toBe('NO');
    expect(await q(STC)).toEqual(stcBefore);
    expect(await q(SUBS)).toEqual(subsBefore);
    const { r1, r2 } = (await q<{ r1: string | null; r2: string | null }>(
      `SELECT to_regclass('public.career_target_requirements')::text AS r1, to_regclass('public.target_coverage')::text AS r2`))[0]!;
    expect([r1, r2]).toEqual([null, null]);
  });

  it('rollback carries cells re-scored or invalidated after cutover back to the old table', async () => {
    await runFile(MIGRATION);
    const [a, b] = await q<{ s: string; c: string }>(
      `SELECT snapshot_id::text AS s, competency_id AS c FROM snapshot_competency_coverage ORDER BY 1,2 LIMIT 2`);
    await q(`UPDATE snapshot_competency_coverage SET rationale = 'rescored after cutover', generated_at = now()
      WHERE snapshot_id = $1::uuid AND competency_id = $2`, [a!.s, a!.c]);
    await q(`DELETE FROM snapshot_competency_coverage WHERE snapshot_id = $1::uuid AND competency_id = $2`, [b!.s, b!.c]);

    await runFile(ROLLBACK);
    const old = await q<{ rationale: string }>(
      `SELECT rationale FROM snapshot_target_coverage WHERE snapshot_id = $1::uuid AND sub_competency_id = $2`, [a!.s, a!.c]);
    expect(old.map(r => r.rationale)).toEqual(['rescored after cutover']);
    const gone = await q(`SELECT 1 FROM snapshot_target_coverage WHERE snapshot_id = $1::uuid AND sub_competency_id = $2`, [b!.s, b!.c]);
    expect(gone).toEqual([]);

    // Repair the scratch clone back to the captured state (the characterization golden depends on it).
    const saved = (k: { s: string; c: string }) =>
      stcBefore.find(r => r.snapshot_id === k.s && r.sub_competency_id === k.c)!;
    const ra = saved(a!);
    const rb = saved(b!);
    await q(`UPDATE snapshot_target_coverage SET rationale = $3, generated_at = $4::timestamptz
      WHERE snapshot_id = $1::uuid AND sub_competency_id = $2`, [a!.s, a!.c, ra.rationale, ra.generated_at]);
    await q(`INSERT INTO snapshot_target_coverage (snapshot_id, career_target_id, sub_competency_id, k_depth, u_depth,
        d_depth, matched_competency, evidence_excerpt, confidence, rationale, model, generated_at)
      VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::timestamptz)`,
      [rb.snapshot_id, rb.career_target_id, rb.sub_competency_id, rb.k_depth, rb.u_depth, rb.d_depth,
       rb.matched_competency, rb.evidence_excerpt, rb.confidence, rb.rationale, rb.model, rb.generated_at]);
    expect(await q(STC)).toEqual(stcBefore);
  });
});
