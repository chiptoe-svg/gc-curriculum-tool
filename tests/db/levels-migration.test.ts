// @vitest-environment node
// Migration 0072 (competency_levels; target_coverage over it) rehearsal on gc_curriculum_links_scratch.
// Every case applies 0072's body inside BEGIN … ROLLBACK, so nothing persists.
// Spec: docs/superpowers/specs/2026-11-20-links-drive-coverage-design.md
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { isLinksScratchDb } from './links/scratch-guard';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATION_PATH = resolve(ROOT, 'drizzle/0072_competency_levels.sql');
const ROLLBACK_PATH = resolve(ROOT, 'scripts/migrations/2026-11-20-levels-rollback.sql');
const strip = (raw: string) => raw.split('\n').filter(l => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;').join('\n');

describe('0072 files exist (static, runs always)', () => {
  it('migration and rollback exist', () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
    expect(existsSync(ROLLBACK_PATH)).toBe(true);
  });
});

describe.skipIf(!isLinksScratchDb())('migration 0072 on the links scratch clone', () => {
  let pool: Pool;
  let S = '', A = '', F = '';
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const q = async (s: string) => (await pool.query(s)).rows;
    S = (await q(`SELECT id FROM course_capture_snapshots WHERE retired_at IS NULL ORDER BY created_at DESC LIMIT 1`))[0].id;
    A = (await q(`SELECT id FROM sub_competencies WHERE NOT retired AND NOT foundational ORDER BY id LIMIT 1`))[0].id;
    F = (await q(`SELECT id FROM sub_competencies WHERE NOT retired AND foundational ORDER BY id LIMIT 1`))[0].id;
  });
  afterAll(async () => { await pool?.end(); });

  async function inTx<T>(fn: (c: PoolClient) => Promise<T>, apply = true): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      try {
        await c.query(`DELETE FROM skill_competency_links WHERE snapshot_id = $1 AND competency_id IN ($2, $3)`, [S, A, F]);
        await c.query(`DELETE FROM competency_rollups WHERE snapshot_id = $1 AND competency_id IN ($2, $3)`, [S, A, F]);
        await c.query(`DELETE FROM snapshot_competency_coverage WHERE snapshot_id = $1 AND competency_id IN ($2, $3)`, [S, A, F]);
        if (apply) await c.query(strip(readFileSync(MIGRATION_PATH, 'utf8')));
        return await fn(c);
      } finally { await c.query('ROLLBACK'); }
    } finally { c.release(); }
  }
  const cell = (c: PoolClient, comp: string, k: number | null, u: number | null, d: number) =>
    c.query(`INSERT INTO snapshot_competency_coverage (snapshot_id, competency_id, k_depth, u_depth, d_depth, matched_competency, confidence, rationale, model)
             VALUES ($1,$2,$3,$4,$5,'skill one','high','scored','gpt-test')`, [S, comp, k, u, d]);
  const link = (c: PoolClient, comp: string, ref: string, source: string, status: string) =>
    c.query(`INSERT INTO skill_competency_links (snapshot_id, skill_ref, statement, competency_id, source, status, decided_at, decided_by)
             VALUES ($1,$2,'skill',$3,$4,$5, CASE WHEN $5 = 'proposed' THEN NULL ELSE now() END, CASE WHEN $5 = 'proposed' THEN NULL ELSE 'tester' END)`, [S, ref, comp, source, status]);
  const rollup = (c: PoolClient, comp: string, method: string, k: number | null, u: number | null, d: number | null) =>
    c.query(`INSERT INTO competency_rollups (snapshot_id, competency_id, k, u, d, method, decided_by) VALUES ($1,$2,$3,$4,$5,$6,'tester')`, [S, comp, k, u, d, method]);
  const level = async (c: PoolClient, comp: string) =>
    (await c.query(`SELECT k_depth k, u_depth u, d_depth d, method FROM competency_levels WHERE snapshot_id = $1 AND competency_id = $2`, [S, comp])).rows;

  it('scored cell with a counting scoring link → method scoring, scorer K/U/D', () => inTx(async c => {
    await cell(c, A, 2, 1, 3); await link(c, A, 'r1', 'scoring', 'proposed');
    expect(await level(c, A)).toEqual([{ k: 2, u: 1, d: 3, method: 'scoring' }]);
  }));
  it('scored cell with no links at all → method scoring (ruling)', () => inTx(async c => {
    await cell(c, A, 2, 1, 3);
    expect(await level(c, A)).toEqual([{ k: 2, u: 1, d: 3, method: 'scoring' }]);
  }));
  it('every link rejected, one embedding suggestion proposed → method rejected, K/U/D 0', () => inTx(async c => {
    await cell(c, A, 2, 1, 3); await link(c, A, 'r1', 'scoring', 'rejected'); await link(c, A, 'r2', 'embedding', 'proposed');
    expect(await level(c, A)).toEqual([{ k: 0, u: 0, d: 0, method: 'rejected' }]);
  }));
  it('rejected foundational competency → K/U null, D 0', () => inTx(async c => {
    await cell(c, F, null, null, 2); await link(c, F, 'r1', 'scoring', 'rejected');
    expect(await level(c, F)).toEqual([{ k: null, u: null, d: 0, method: 'rejected' }]);
  }));
  it('faculty roll-up beats the scorer → method faculty, roll-up K/U/D', () => inTx(async c => {
    await cell(c, A, 2, 1, 3); await link(c, A, 'r1', 'scoring', 'proposed'); await rollup(c, A, 'faculty', 1, 1, 1);
    expect(await level(c, A)).toEqual([{ k: 1, u: 1, d: 1, method: 'faculty' }]);
  }));
  it('ai roll-up used when no faculty roll-up → method ai', () => inTx(async c => {
    await cell(c, A, 2, 1, 3); await rollup(c, A, 'ai', 3, 2, 2);
    expect(await level(c, A)).toEqual([{ k: 3, u: 2, d: 2, method: 'ai' }]);
  }));
  it('confirmed embedding link, no scorer cell → method needs_level, D 0, row present', () => inTx(async c => {
    await link(c, A, 'r1', 'embedding', 'confirmed');
    expect(await level(c, A)).toEqual([{ k: 0, u: 0, d: 0, method: 'needs_level' }]);
  }));
  it('confirmed embedding link, scorer cell all zero → method needs_level', () => inTx(async c => {
    await cell(c, A, 0, 0, 0); await link(c, A, 'r1', 'embedding', 'confirmed');
    expect(await level(c, A)).toEqual([{ k: 0, u: 0, d: 0, method: 'needs_level' }]);
  }));
  it('scorer zero with only an embedding suggestion → a real 0, method scoring', () => inTx(async c => {
    await cell(c, A, 0, 0, 0); await link(c, A, 'r1', 'embedding', 'proposed');
    expect(await level(c, A)).toEqual([{ k: 0, u: 0, d: 0, method: 'scoring' }]);
  }));
  it('foundational competency with faculty K/U set → K and U null', () => inTx(async c => {
    await rollup(c, F, 'faculty', 3, 3, 2);
    expect(await level(c, F)).toEqual([{ k: null, u: null, d: 2, method: 'faculty' }]);
  }));
  it('retired snapshot / retired competency → no row from links or roll-ups alone', () => inTx(async c => {
    await link(c, A, 'r1', 'faculty', 'confirmed'); await rollup(c, F, 'faculty', null, null, 2);
    await c.query(`UPDATE sub_competencies SET retired = true WHERE id = $1`, [A]);
    expect(await level(c, A)).toEqual([]);
    await c.query(`UPDATE course_capture_snapshots SET retired_at = now() WHERE id = $1`, [S]);
    expect(await level(c, F)).toEqual([]);
  }));
  it('target_coverage over live data: identical before and after 0072', () => inTx(async c => {
    await c.query(`CREATE TEMP TABLE before_tc AS SELECT * FROM target_coverage`);
    await c.query(strip(readFileSync(MIGRATION_PATH, 'utf8')));
    const diff = (await c.query(`(SELECT * FROM before_tc EXCEPT SELECT * FROM target_coverage) UNION ALL (SELECT * FROM target_coverage EXCEPT SELECT * FROM before_tc)`)).rows;
    expect(diff).toEqual([]);
    const n = (await c.query(`SELECT count(*)::int n FROM before_tc`)).rows[0].n;
    expect(n).toBeGreaterThan(1000);
  }, false));
  it('rollback restores target_coverage over the table and drops competency_levels', () => inTx(async c => {
    await c.query(strip(readFileSync(ROLLBACK_PATH, 'utf8')));
    const v = (await c.query(`SELECT count(*)::int n FROM pg_views WHERE viewname = 'competency_levels'`)).rows[0].n;
    expect(v).toBe(0);
    expect((await c.query(`SELECT count(*)::int n FROM target_coverage`)).rows[0].n).toBeGreaterThan(1000);
  }));
});
