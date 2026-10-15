// @vitest-environment node
// Migration 0059 (P2) rehearsal: bundle membership tables (cards, embeddings
// cache, O*NET element definitions, mapping runs/outcomes, members, blind
// golden sample). Purely additive — eight new tables, nothing altered or
// dropped. Gated on isP2PreDb(): every case runs 0059's body (stripped of
// its own BEGIN;/COMMIT;) inside its own BEGIN … ROLLBACK on a dedicated
// connection, so nothing ever persists. Safe to run repeatedly against
// gc_curriculum_p2_pre, which stays pre-0059 forever. Modeled on
// tests/db/p1-migration.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { isP2PreDb } from './p2/scratch-guard';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATION_PATH = resolve(ROOT, 'drizzle/0059_competency_catalog_p2.sql');
const ROLLBACK_PATH = resolve(ROOT, 'scripts/migrations/2026-10-13-p2-rollback.sql');
const VERIFY_PATH = resolve(ROOT, 'scripts/migrations/2026-10-13-p2-verify.sql');

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

const RUN = isP2PreDb();

const NEW_TABLES = [
  'bundle_cards', 'item_embeddings', 'onet_element_definitions', 'bundle_mapping_runs',
  'bundle_members', 'bundle_mapping_outcomes', 'bundle_golden_samples', 'bundle_golden_picks',
] as const;

describe('0059 and its rollback/verify files exist and parse (static, runs always)', () => {
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

describe.skipIf(!RUN)('migration 0059 (P2) on the P2 pre clone, each case self-contained', () => {
  let pool: Pool;

  beforeAll(() => {
    if (MIGRATION_BODY === null || ROLLBACK_BODY === null || VERIFY_BODY === null) {
      throw new Error('0059 migration/rollback/verify files must exist before this suite can run');
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
   * transaction isn't left aborted for the next statement. Returns the error
   * so the caller can assert on it. */
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

  async function nonNewTableColumns(c: PoolClient) {
    return q(
      c,
      `SELECT table_name, column_name, data_type, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name <> ALL($1)
       ORDER BY table_name, column_name`,
      [NEW_TABLES],
    );
  }

  async function firstSubCompetencyId(c: PoolClient): Promise<string> {
    const rows = await q<{ id: string }>(c, `SELECT id FROM sub_competencies LIMIT 1`);
    if (!rows[0]) throw new Error('fixture requires at least one sub_competencies row on the scratch clone');
    return rows[0].id;
  }

  it('precondition: the pre clone is post-0058 and pre-0059 before any test runs', async () => {
    await withTx(async (c) => {
      expect(await tableExists(c, 'onet_release')).toBe(true);
      for (const table of NEW_TABLES) {
        expect(await tableExists(c, table), `${table} should not exist before 0059`).toBe(false);
      }
    });
  });

  it('creates all eight new tables', async () => {
    await withTx(async (c) => {
      for (const table of NEW_TABLES) {
        expect(await tableExists(c, table), `${table} should not exist before 0059`).toBe(false);
      }
      await c.query(MIGRATION_BODY!);
      for (const table of NEW_TABLES) {
        expect(await tableExists(c, table), `${table} should exist after 0059`).toBe(true);
      }
    });
  });

  it('a second run inside the same transaction raises 0059: already applied', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await expect(c.query(MIGRATION_BODY!)).rejects.toThrow(/0059: already applied/);
    });
  });

  it('on a database without onet_release raises 0059: precondition', async () => {
    await withTx(async (c) => {
      await c.query(`DROP TABLE onet_task_ratings, onet_task_statements, onet_element_ratings, onet_occupations, onet_release CASCADE`);
      await expect(c.query(MIGRATION_BODY!)).rejects.toThrow(/0059: precondition/);
    });
  });

  it('migration body then verify body completes without error', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await expect(c.query(VERIFY_BODY!)).resolves.toBeDefined();
    });
  });

  it('rollback body returns the schema to the exact pre-0059 shape', async () => {
    await withTx(async (c) => {
      const columnsBefore = await nonNewTableColumns(c);
      expect(columnsBefore.length).toBeGreaterThan(0); // sanity: the comparison isn't vacuous

      await c.query(MIGRATION_BODY!);
      await c.query(ROLLBACK_BODY!);

      const tablesAfter = (
        await q<{ table_name: string }>(
          c,
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1) ORDER BY table_name`,
          [NEW_TABLES],
        )
      ).map((r) => r.table_name);
      expect(tablesAfter).toEqual([]);

      const columnsAfter = await nonNewTableColumns(c);
      expect(columnsAfter).toEqual(columnsBefore);
    });
  });

  it('rollback refuses with rollback: precondition when a confirmed member exists', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      const bundleId = await firstSubCompetencyId(c);
      await q(
        c,
        `INSERT INTO bundle_members (bundle_id, source, external_id, external_label, position, status, proposed_by, confirmed_by, confirmed_at)
         VALUES ($1, 'course_skill', 'ext-confirmed', 'Confirmed label', 'core', 'confirmed', 'ai', 'owner', now())`,
        [bundleId],
      );
      await expect(c.query(ROLLBACK_BODY!)).rejects.toThrow(/rollback: precondition/);
    });
  });

  describe('CHECK behavior', () => {
    it('inserting bundle_members with source=onet_task and onet_soc_code IS NULL fails', async () => {
      await withTx(async (c) => {
        await c.query(MIGRATION_BODY!);
        const bundleId = await firstSubCompetencyId(c);
        const err = await expectFailure(
          c,
          `INSERT INTO bundle_members (bundle_id, source, external_id, external_label, release, position, status, proposed_by)
           VALUES ($1, 'onet_task', 'task-1', 'Task label', '31.0', 'core', 'proposed', 'ai')`,
          [bundleId],
        );
        expect(err.message).toMatch(/violates check constraint/);
      });
    });

    it('inserting with status=confirmed and confirmed_by IS NULL fails', async () => {
      await withTx(async (c) => {
        await c.query(MIGRATION_BODY!);
        const bundleId = await firstSubCompetencyId(c);
        const err = await expectFailure(
          c,
          `INSERT INTO bundle_members (bundle_id, source, external_id, external_label, position, status, proposed_by)
           VALUES ($1, 'course_skill', 'cs-1', 'Course skill label', 'core', 'confirmed', 'ai')`,
          [bundleId],
        );
        expect(err.message).toMatch(/violates check constraint/);
      });
    });

    it('two element rows with identical (bundle, source, release, external_id) and both onet_soc_code NULL violate the unique constraint', async () => {
      await withTx(async (c) => {
        await c.query(MIGRATION_BODY!);
        const bundleId = await firstSubCompetencyId(c);
        const insert = () =>
          q(
            c,
            `INSERT INTO bundle_members (bundle_id, source, external_id, external_label, release, position, status, proposed_by)
             VALUES ($1, 'onet_element', 'elem-1', 'Element label', '31.0', 'core', 'proposed', 'ai')`,
            [bundleId],
          );
        await insert();
        await expect(insert()).rejects.toThrow(/duplicate key value violates unique constraint/);
      });
    });
  });
});
