// @vitest-environment node
// Migration 0058 (P1) rehearsal: occupation-mix tables, O*NET reference store,
// catalog `origin` column. Purely additive — no data migration like 0057's
// merges. Gated on isP1PreDb(): every case runs 0058's body (stripped of
// its own BEGIN;/COMMIT;) inside its own BEGIN … ROLLBACK on a dedicated
// connection, so nothing ever persists. Safe to run repeatedly against
// gc_curriculum_p1_pre, which stays pre-0058 forever.
//
// Fix round 1 (controller ruling, 2026-10-12): originally gated on
// isP1ScratchDb(), the ONE P1 scratch clone — but Task 2 Step 7 real-applied
// 0058 to that same clone, so every case here that calls MIGRATION_BODY hit
// 0058's own already-applied guard and FAILED (not skipped) from then on.
// Same shape as P0b's problem, same fix: p1-scratch-db.sh gained
// create-pre/url-pre/drop-pre for a second clone, gc_curriculum_p1_pre, kept
// pre-0058 forever; this file now gates on isP1PreDb() instead, so pointing
// DATABASE_URL at the main scratch SKIPS this suite rather than failing it.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { isP1PreDb } from './p1/scratch-guard';

const ROOT = resolve(__dirname, '../..');
const MIGRATION_PATH = resolve(ROOT, 'drizzle/0058_competency_catalog_p1.sql');
const ROLLBACK_PATH = resolve(ROOT, 'scripts/migrations/2026-10-12-p1-rollback.sql');
const VERIFY_PATH = resolve(ROOT, 'scripts/migrations/2026-10-12-p1-verify.sql');

/** Strip the file's own BEGIN;/COMMIT; so the body can run inside a caller-owned transaction. */
function stripTxWrapper(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => line.trim() !== 'BEGIN;' && line.trim() !== 'COMMIT;')
    .join('\n');
}

/** verify.sql's own wrapper is \set ON_ERROR_STOP on / BEGIN READ ONLY; / ... / ROLLBACK; — strip all three so the SELECT + DO $$ body can run inside a caller-owned transaction (the \set meta-command isn't valid SQL at all over a plain pg client). */
function stripVerifyWrapper(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t !== '\\set ON_ERROR_STOP on' && t !== 'BEGIN READ ONLY;' && t !== 'ROLLBACK;';
    })
    .join('\n');
}

const MIGRATION_BODY = existsSync(MIGRATION_PATH) ? stripTxWrapper(readFileSync(MIGRATION_PATH, 'utf8')) : null;
const ROLLBACK_BODY = existsSync(ROLLBACK_PATH) ? stripTxWrapper(readFileSync(ROLLBACK_PATH, 'utf8')) : null;
const VERIFY_BODY = existsSync(VERIFY_PATH) ? stripVerifyWrapper(readFileSync(VERIFY_PATH, 'utf8')) : null;

const RUN = isP1PreDb();

const NEW_TABLES = [
  'career_target_occupations',
  'onet_release',
  'onet_occupations',
  'onet_element_ratings',
  'onet_task_statements',
  'onet_task_ratings',
] as const;

describe('0058 and its rollback/verify files exist and parse (static, runs always)', () => {
  it('the migration file exists', () => {
    expect(existsSync(MIGRATION_PATH), `expected ${MIGRATION_PATH} to exist`).toBe(true);
  });
  it('the rollback file exists', () => {
    expect(existsSync(ROLLBACK_PATH), `expected ${ROLLBACK_PATH} to exist`).toBe(true);
  });
  it('the verify file exists', () => {
    expect(existsSync(VERIFY_PATH), `expected ${VERIFY_PATH} to exist`).toBe(true);
  });
});

describe.skipIf(!RUN)('migration 0058 (P1) on the P1 scratch clone, each case self-contained', () => {
  let pool: Pool;

  beforeAll(() => {
    if (MIGRATION_BODY === null || ROLLBACK_BODY === null || VERIFY_BODY === null) {
      throw new Error('0058 migration/rollback/verify files must exist before this suite can run');
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool?.end();
  });

  /** Run fn inside BEGIN … ROLLBACK on a dedicated client. Always rolls back,
   * so nothing a test does — including a failed migration run — ever persists. */
  async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      try {
        return await fn(c);
      } finally {
        await c.query('ROLLBACK');
      }
    } finally {
      c.release();
    }
  }

  const q = async <T = Record<string, unknown>>(c: PoolClient, text: string, params: unknown[] = []) =>
    (await c.query(text, params)).rows as T[];

  /** Run a statement expected to fail inside a SAVEPOINT, so the surrounding
   * transaction isn't left aborted for the next statement (a failed query
   * inside a plain BEGIN … leaves every later query erroring with "current
   * transaction is aborted" until ROLLBACK, which would hide every CHECK
   * after the first). Returns the error so the caller can assert on it. */
  async function expectFailure(c: PoolClient, text: string, params: unknown[] = []): Promise<Error> {
    await c.query('SAVEPOINT sp');
    try {
      await c.query(text, params);
      throw new Error(`expected this statement to fail but it succeeded: ${text}`);
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT sp');
      await c.query('RELEASE SAVEPOINT sp');
      return err as Error;
    }
  }

  async function tableExists(c: PoolClient, table: string): Promise<boolean> {
    const rows = await q<{ exists: boolean }>(c, `SELECT to_regclass('public.' || $1) IS NOT NULL AS exists`, [table]);
    return rows[0]!.exists;
  }

  it('precondition: the scratch clone is post-P0b and pre-0058 before any test runs', async () => {
    await withTx(async (c) => {
      expect(await tableExists(c, 'sub_competency_map')).toBe(true);
      expect(await tableExists(c, 'career_target_occupations')).toBe(false);
      const hasOriginRows = await q<{ exists: boolean }>(
        c,
        `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sub_competencies' AND column_name = 'origin') AS exists`,
      );
      expect(hasOriginRows[0]!.exists).toBe(false);
    });
  });

  it('creates all six new tables and the sub_competencies.origin column, backfilling every existing row to migrated', async () => {
    await withTx(async (c) => {
      for (const table of NEW_TABLES) {
        expect(await tableExists(c, table), `${table} should not exist before 0058`).toBe(false);
      }

      await c.query(MIGRATION_BODY!);

      for (const table of NEW_TABLES) {
        expect(await tableExists(c, table), `${table} should exist after 0058`).toBe(true);
      }

      const [originCol] = await q<{ data_type: string; is_nullable: string; column_default: string | null }>(
        c,
        `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_name = 'sub_competencies' AND column_name = 'origin'`,
      );
      expect(originCol).toBeDefined();
      expect(originCol!.data_type).toBe('text');
      expect(originCol!.is_nullable).toBe('NO');
      expect(originCol!.column_default).toMatch(/'migrated'::text/);

      const { n } = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM sub_competencies WHERE origin <> 'migrated'`))[0]!;
      expect(n).toBe('0');
      const { total } = (await q<{ total: string }>(c, `SELECT count(*)::text AS total FROM sub_competencies`))[0]!;
      expect(Number(total)).toBeGreaterThan(0); // the scratch clone has real rows — the backfill is actually exercised
    });
  });

  it('enforces the origin CHECK on sub_competencies', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      const id = (await q<{ id: string }>(c, `SELECT id FROM sub_competencies LIMIT 1`))[0]!.id;
      await expect(q(c, `UPDATE sub_competencies SET origin = 'bogus' WHERE id = $1`, [id])).rejects.toThrow(/violates check constraint/);
    });
  });

  it('enforces career_target_occupations CHECKs: horizon, soc_code format, onet_soc_code format, onet_status enum, count, share, source, and the rated/code consistency rule', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      const targetId = (await q<{ id: string }>(c, `SELECT id FROM career_targets LIMIT 1`))[0]!.id;
      type Row = {
        horizon?: string;
        soc_code: string;
        onet_soc_code?: string | null;
        onet_status: string;
        count: number;
        share: number;
        source: string;
        source_version: string;
      };
      const base: Row = {
        soc_code: '15-1252',
        onet_status: 'unrated',
        count: 3,
        share: 0.5,
        source: 'alumni_rule',
        source_version: 'v1',
      };
      const insertSql = (overrides: Partial<Row>) => {
        const row = { ...base, ...overrides };
        return {
          text: `INSERT INTO career_target_occupations
             (career_target_id, horizon, soc_code, onet_soc_code, onet_status, count, share, source, source_version, as_of)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_DATE)`,
          params: [targetId, row.horizon ?? 'entry', row.soc_code, row.onet_soc_code ?? null, row.onet_status, row.count, row.share, row.source, row.source_version],
        };
      };
      const expectCheckViolation = async (overrides: Partial<Row>) => {
        const { text, params } = insertSql(overrides);
        const err = await expectFailure(c, text, params);
        expect(err.message).toMatch(/violates check constraint/);
      };

      await expectCheckViolation({ horizon: 'mid' });
      await expectCheckViolation({ soc_code: 'not-a-soc' });
      await expectCheckViolation({ onet_soc_code: 'not-a-onet-code' });
      await expectCheckViolation({ onet_status: 'bogus' });
      await expectCheckViolation({ count: 0 });
      await expectCheckViolation({ count: -1 });
      await expectCheckViolation({ share: 0 });
      await expectCheckViolation({ share: 1.5 });
      await expectCheckViolation({ source: 'bogus' });
      // onet_status = 'rated' requires a non-null onet_soc_code, and vice versa.
      await expectCheckViolation({ onet_status: 'rated', onet_soc_code: null });
      await expectCheckViolation({ onet_status: 'unrated', onet_soc_code: '15-1252.00' });

      // A row that satisfies every CHECK inserts cleanly.
      const { text, params } = insertSql({});
      await q(c, text, params);
    });
  });

  it('enforces UNIQUE NULLS NOT DISTINCT on career_target_occupations (career_target_id, horizon, soc_code, onet_soc_code, source)', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      const targetId = (await q<{ id: string }>(c, `SELECT id FROM career_targets LIMIT 1`))[0]!.id;
      const insertUnrated = (sourceVersion: string) =>
        q(
          c,
          `INSERT INTO career_target_occupations
             (career_target_id, horizon, soc_code, onet_soc_code, onet_status, count, share, source, source_version, as_of)
           VALUES ($1, 'entry', '15-1252', NULL, 'unrated', 3, 0.5, 'alumni_rule', $2, CURRENT_DATE)`,
          [targetId, sourceVersion],
        );
      await insertUnrated('v1');
      // Two rows with an identical (career_target_id, horizon, soc_code, source) and both onet_soc_code NULL
      // must collide under NULLS NOT DISTINCT even though source_version differs — plain UNIQUE would let this through.
      await expect(insertUnrated('v2')).rejects.toThrow(/duplicate key value violates unique constraint/);
    });
  });

  it('enforces domain and scale_id CHECKs on onet_element_ratings and onet_task_ratings, and FK cascades from onet_release through to ratings', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await q(c, `INSERT INTO onet_release (release, published, license, attribution, source_url)
        VALUES ('31.0', 'August 2026', 'CC BY 4.0', 'attribution text', 'https://www.onetcenter.org/database.html')`);
      await q(c, `INSERT INTO onet_occupations (release, onet_soc_code, title, description)
        VALUES ('31.0', '15-1252.00', 'Software Developers', 'desc')`);

      expect(
        (
          await expectFailure(c, `INSERT INTO onet_element_ratings
            (release, onet_soc_code, domain, element_id, element_name, scale_id, data_value, recommend_suppress, not_relevant, date_text, domain_source)
          VALUES ('31.0', '15-1252.00', 'bogus_domain', '2.A.1.a', 'Reading Comprehension', 'IM', 4.5, false, false, '07/2026', 'Analyst')`)
        ).message,
      ).toMatch(/violates check constraint/);

      expect(
        (
          await expectFailure(c, `INSERT INTO onet_element_ratings
            (release, onet_soc_code, domain, element_id, element_name, scale_id, data_value, recommend_suppress, not_relevant, date_text, domain_source)
          VALUES ('31.0', '15-1252.00', 'abilities', '2.A.1.a', 'Reading Comprehension', 'XX', 4.5, false, false, '07/2026', 'Analyst')`)
        ).message,
      ).toMatch(/violates check constraint/);

      // A row referencing an (release, onet_soc_code) that onet_occupations doesn't have must fail the FK.
      expect(
        (
          await expectFailure(c, `INSERT INTO onet_element_ratings
            (release, onet_soc_code, domain, element_id, element_name, scale_id, data_value, recommend_suppress, not_relevant, date_text, domain_source)
          VALUES ('31.0', '99-9999.00', 'abilities', '2.A.1.a', 'Reading Comprehension', 'IM', 4.5, false, false, '07/2026', 'Analyst')`)
        ).message,
      ).toMatch(/violates foreign key constraint/);

      await q(c, `INSERT INTO onet_element_ratings
          (release, onet_soc_code, domain, element_id, element_name, scale_id, data_value, recommend_suppress, not_relevant, date_text, domain_source)
        VALUES ('31.0', '15-1252.00', 'abilities', '2.A.1.a', 'Reading Comprehension', 'IM', 4.5, false, false, '07/2026', 'Analyst')`);

      await q(c, `INSERT INTO onet_task_statements (release, onet_soc_code, task_id, task)
        VALUES ('31.0', '15-1252.00', '1', 'Write code')`);
      expect(
        (
          await expectFailure(c, `INSERT INTO onet_task_ratings
            (release, onet_soc_code, task_id, scale_id, category, data_value, recommend_suppress, date_text, domain_source)
          VALUES ('31.0', '15-1252.00', '1', 'XX', '', 4.5, false, '07/2026', 'Analyst')`)
        ).message,
      ).toMatch(/violates check constraint/);
      await q(c, `INSERT INTO onet_task_ratings
          (release, onet_soc_code, task_id, scale_id, category, data_value, recommend_suppress, date_text, domain_source)
        VALUES ('31.0', '15-1252.00', '1', 'FT', 'Yearly', 20, false, '07/2026', 'Analyst')`);

      // Deleting the release cascades all the way down.
      await q(c, `DELETE FROM onet_release WHERE release = '31.0'`);
      const { n } = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM onet_occupations`))[0]!;
      expect(n).toBe('0');
      const { m } = (await q<{ m: string }>(c, `SELECT count(*)::text AS m FROM onet_element_ratings`))[0]!;
      expect(m).toBe('0');
      const { k } = (await q<{ k: string }>(c, `SELECT count(*)::text AS k FROM onet_task_ratings`))[0]!;
      expect(k).toBe('0');
    });
  });

  it('cascades a deleted career_target to its career_target_occupations rows', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await q(c, `INSERT INTO career_targets
          (id, name, short_definition, industry_contexts, know_descriptors, understand_descriptors, do_descriptors, defensibility_note, display_order)
        VALUES ('zz-p1-migration-target', 'ZZ P1 migration fixture', 'def', '[]', '[]', '[]', '[]', 'note', 999)`);
      await q(c, `INSERT INTO career_target_occupations
          (career_target_id, horizon, soc_code, onet_status, count, share, source, source_version, as_of)
        VALUES ('zz-p1-migration-target', 'entry', '15-1252', 'unrated', 1, 1, 'alumni_rule', 'v1', CURRENT_DATE)`);
      await q(c, `DELETE FROM career_targets WHERE id = 'zz-p1-migration-target'`);
      const { n } = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM career_target_occupations WHERE career_target_id = 'zz-p1-migration-target'`))[0]!;
      expect(n).toBe('0');
    });
  });

  it('a second run inside the same transaction raises 0058: already applied', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await expect(c.query(MIGRATION_BODY!)).rejects.toThrow(/0058: already applied/);
    });
  });

  /** pg_constraint rows for sub_competencies: name, type, and the full
   * definition text (pg_get_constraintdef) — catches a constraint whose
   * SHAPE changed (a different CHECK expression, a different FK target)
   * even when its name and the table's column list are unchanged, which
   * the table/column-only comparison below it can't see. */
  async function subCompetenciesConstraints(c: PoolClient) {
    return q<{ conname: string; contype: string; definition: string }>(
      c,
      `SELECT con.conname, con.contype::text, pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = 'public' AND rel.relname = 'sub_competencies'
       ORDER BY con.conname`,
    );
  }

  it('running the rollback body after the migration body returns the schema to the exact pre-0058 shape', async () => {
    await withTx(async (c) => {
      const tablesBefore = (
        await q<{ table_name: string }>(c, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`, [
          NEW_TABLES,
        ])
      ).map((r) => r.table_name);
      expect(tablesBefore).toEqual([]);
      const columnsBefore = await q(
        c,
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'sub_competencies' ORDER BY column_name`,
      );
      const constraintsBefore = await subCompetenciesConstraints(c);
      expect(constraintsBefore.length).toBeGreaterThan(0); // sanity: sub_competencies already has constraints pre-0058 (merged_into_fkey etc.) — the comparison isn't vacuous

      await c.query(MIGRATION_BODY!);
      await c.query(ROLLBACK_BODY!);

      const tablesAfter = (
        await q<{ table_name: string }>(c, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`, [
          NEW_TABLES,
        ])
      ).map((r) => r.table_name);
      expect(tablesAfter).toEqual([]);
      const columnsAfter = await q(
        c,
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'sub_competencies' ORDER BY column_name`,
      );
      expect(columnsAfter).toEqual(columnsBefore);
      const constraintsAfter = await subCompetenciesConstraints(c);
      expect(constraintsAfter).toEqual(constraintsBefore);
    });
  });

  // Red-proof (fix round 1, Important #2): proves the constraints comparison
  // above actually discriminates — a real constraint-shape change (here, a
  // CHECK whose definition differs) is caught even though the column list
  // (what the OLD version of this test compared alone) is completely
  // unaffected by it, which is exactly the gap the hostile review found.
  it('red-proof: the constraints comparison fails when a definition differs, even though the column list does not', async () => {
    await withTx(async (c) => {
      const columnsBefore = await q(
        c,
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'sub_competencies' ORDER BY column_name`,
      );

      await c.query(MIGRATION_BODY!);
      await c.query(ROLLBACK_BODY!);

      const columnsAfter = await q(
        c,
        `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'sub_competencies' ORDER BY column_name`,
      );
      const constraintsAfter = await subCompetenciesConstraints(c);

      const corrupted = constraintsAfter.map((row) =>
        row.conname === 'sub_competencies_merged_into_retired_check' ? { ...row, definition: 'CHECK (false)' } : row,
      );
      expect(corrupted, 'the corruption must actually change something for this red-proof to mean anything').not.toEqual(constraintsAfter);
      // The column list is completely unaffected by the corruption — proving
      // the OLD (columns-only) comparison would have passed right through
      // this exact defect, while the new constraints comparison below does not.
      expect(columnsAfter).toEqual(columnsBefore);
      expect(() => expect(corrupted).toEqual(constraintsAfter)).toThrow();
    });
  });

  it('the rollback refuses with rollback: precondition if a gc_authored or onet_seeded competency exists', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await q(c, `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, retired, origin)
        VALUES ('zz-p1-migration-gc-authored', 'ZZ P1 fixture', 'k', 'u', 'd', false, 'gc_authored')`);
      await expect(c.query(ROLLBACK_BODY!)).rejects.toThrow(/rollback: precondition/);
    });
  });

  it('the rollback proceeds when every competency is still origin=migrated', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await expect(c.query(ROLLBACK_BODY!)).resolves.toBeDefined();
      expect(await tableExists(c, 'career_target_occupations')).toBe(false);
    });
  });

  // ─── m6 (hostile-review fix wave): verify.sql content checks ───────────
  // The pre-existing checks only proved the TABLES/COLUMN exist. The new
  // one walks every 0058 constraint by name via pg_constraint, so a
  // migration that silently lost a CHECK/UNIQUE/FK still fails verify even
  // though every table and column is present.

  it('verify.sql passes cleanly immediately after a fresh apply', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await expect(c.query(VERIFY_BODY!)).resolves.toBeDefined();
    });
  });

  it('red-proof: verify.sql fails when an expected CHECK constraint is dropped, even though every table/column is still present', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await q(c, `ALTER TABLE sub_competencies DROP CONSTRAINT sub_competencies_origin_check`);
      // The table and the origin column are both still there — only the
      // pg_constraint-backed check added for m6 can catch this.
      expect(await tableExists(c, 'sub_competencies')).toBe(true);
      await expect(c.query(VERIFY_BODY!)).rejects.toThrow(/expected constraint "sub_competencies_origin_check" is missing/);
    });
  });

  it('red-proof: verify.sql also catches a dropped FK (not just a dropped CHECK)', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await q(c, `ALTER TABLE career_target_occupations DROP CONSTRAINT career_target_occupations_career_target_id_fkey`);
      await expect(c.query(VERIFY_BODY!)).rejects.toThrow(/expected constraint "career_target_occupations_career_target_id_fkey" is missing/);
    });
  });
});
