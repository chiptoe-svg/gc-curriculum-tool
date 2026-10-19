// @vitest-environment node
// Migration 0060 (catalog foundationals) rehearsal: sub_competencies gains
// foundational + scoring, K/U descriptors become nullable. Gated on
// isCaPreDb(): every case runs 0060's body (stripped of its own BEGIN;/COMMIT;)
// inside its own BEGIN … ROLLBACK on a dedicated connection, so nothing ever
// persists. gc_curriculum_ca_pre stays pre-0060 forever. Modeled on
// tests/db/p2-migration.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { isCaPreDb } from './ca/scratch-guard';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATION_PATH = resolve(ROOT, 'drizzle/0060_catalog_foundationals.sql');
const ROLLBACK_PATH = resolve(ROOT, 'scripts/migrations/2026-10-19-ca-rollback.sql');
const VERIFY_PATH = resolve(ROOT, 'scripts/migrations/2026-10-19-ca-verify.sql');

function stripTxWrapper(raw: string): string {
  return raw
    .split('\n')
    .filter((line) => line.trim() !== 'BEGIN;' && line.trim() !== 'COMMIT;')
    .join('\n');
}

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

const RUN = isCaPreDb();

describe('0060 and its rollback/verify files exist (static, runs always)', () => {
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

describe.skipIf(!RUN)('migration 0060 on the CA pre clone, each case self-contained', () => {
  let pool: Pool;

  beforeAll(() => {
    if (MIGRATION_BODY === null || ROLLBACK_BODY === null || VERIFY_BODY === null) {
      throw new Error('0060 migration/rollback/verify files must exist before this suite can run');
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });

  afterAll(async () => {
    await pool?.end();
  });

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

  async function columnNames(c: PoolClient): Promise<string[]> {
    return (
      await q<{ column_name: string }>(
        c,
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'sub_competencies' AND column_name IN ('foundational','scoring') ORDER BY column_name`,
      )
    ).map((r) => r.column_name);
  }

  const insertFoundational = `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, foundational)
     VALUES ('ca-f','n',NULL,NULL,'d',true)`;

  it('precondition: the pre clone is post-0058 and pre-0060', async () => {
    await withTx(async (c) => {
      expect(await columnNames(c)).toEqual([]);
      const rows = await q(c, `SELECT 1 FROM information_schema.columns WHERE table_name='sub_competencies' AND column_name='origin'`);
      expect(rows.length).toBe(1);
    });
  });

  it('adds both columns; every pre-existing row is foundational=false, scoring=direct', async () => {
    await withTx(async (c) => {
      const before = (await q<{ n: string }>(c, `SELECT count(*)::text AS n FROM sub_competencies`))[0]!.n;
      expect(Number(before)).toBeGreaterThan(0);
      await c.query(MIGRATION_BODY!);
      expect(await columnNames(c)).toEqual(['foundational', 'scoring']);
      const bad = await q<{ n: string }>(
        c,
        `SELECT count(*)::text AS n FROM sub_competencies WHERE foundational IS DISTINCT FROM false OR scoring IS DISTINCT FROM 'direct'`,
      );
      expect(bad[0]!.n).toBe('0');
    });
  });

  it('migration body then verify body completes without error', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await expect(c.query(VERIFY_BODY!)).resolves.toBeDefined();
    });
  });

  it('foundational=true with a non-null know_descriptor violates the K/U check', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      const err = await expectFailure(
        c,
        `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, foundational)
         VALUES ('ca-x','n','x',NULL,'d',true)`,
      );
      expect(err.message).toMatch(/sub_competencies_foundational_ku_check/);
    });
  });

  // NOTE: the brief's CHECK (foundational = (know IS NULL AND understand IS NULL))
  // only fires when BOTH are null; a half-null row (know NULL, understand set)
  // with foundational=false is permitted by it. Flagged to the controller.
  it('foundational=false with null know AND understand descriptors violates the K/U check', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      const err = await expectFailure(
        c,
        `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, foundational)
         VALUES ('ca-y','n',NULL,NULL,'d',false)`,
      );
      expect(err.message).toMatch(/sub_competencies_foundational_ku_check/);
    });
  });

  it('scoring=other violates the scoring check', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      const err = await expectFailure(
        c,
        `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, scoring)
         VALUES ('ca-z','n','k','u','d','other')`,
      );
      expect(err.message).toMatch(/sub_competencies_scoring_check/);
    });
  });

  it('old-shape insert (no new columns) still succeeds and reads back defaults', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await c.query(
        `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor) VALUES ('ca-old-shape','n','k','u','d')`,
      );
      const rows = await q<{ foundational: boolean; scoring: string }>(
        c,
        `SELECT foundational, scoring FROM sub_competencies WHERE id = 'ca-old-shape'`,
      );
      expect(rows).toEqual([{ foundational: false, scoring: 'direct' }]);
    });
  });

  it('a second run of the body raises 0060: already applied', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await c.query('SAVEPOINT again');
      await expect(c.query(MIGRATION_BODY!)).rejects.toThrow(/0060: already applied/);
      await c.query('ROLLBACK TO SAVEPOINT again');
    });
  });

  it('rollback body restores the pre-0060 shape (columns gone, K/U NOT NULL)', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await c.query(ROLLBACK_BODY!);
      expect(await columnNames(c)).toEqual([]);
      const nullable = await q<{ column_name: string; is_nullable: string }>(
        c,
        `SELECT column_name, is_nullable FROM information_schema.columns
         WHERE table_name = 'sub_competencies' AND column_name IN ('know_descriptor','understand_descriptor') ORDER BY column_name`,
      );
      expect(nullable).toEqual([
        { column_name: 'know_descriptor', is_nullable: 'NO' },
        { column_name: 'understand_descriptor', is_nullable: 'NO' },
      ]);
      const cons = await q(c, `SELECT 1 FROM pg_constraint WHERE conname IN ('sub_competencies_foundational_ku_check','sub_competencies_scoring_check')`);
      expect(cons.length).toBe(0);
    });
  });

  it('rollback raises when 0060 is not applied', async () => {
    await withTx(async (c) => {
      await expect(c.query(ROLLBACK_BODY!)).rejects.toThrow(/rollback: 0060 is not applied/);
    });
  });

  it('rollback refuses when a foundational row exists', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await c.query(insertFoundational);
      await expect(c.query(ROLLBACK_BODY!)).rejects.toThrow(/rollback: foundational or derived rows exist/);
    });
  });

  it('rollback refuses when a derived row exists', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await c.query(
        `INSERT INTO sub_competencies (id, name, know_descriptor, understand_descriptor, do_descriptor, scoring)
         VALUES ('ca-d','n','k','u','d','derived')`,
      );
      await expect(c.query(ROLLBACK_BODY!)).rejects.toThrow(/rollback: foundational or derived rows exist/);
    });
  });
});
