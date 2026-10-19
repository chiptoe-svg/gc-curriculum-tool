// @vitest-environment node
// Migration 0061 (item_embeddings.kind gains 'onet_element') rehearsal. Gated
// on isCaScratchDb() (0059 + 0060 applied, 0061 not): every case runs the body
// (stripped of its own BEGIN;/COMMIT;) inside its own BEGIN ... ROLLBACK on a
// dedicated connection, so nothing ever persists. Modeled on ca-migration.test.ts.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { isCaScratchDb } from './ca/scratch-guard';

const ROOT = resolve(__dirname, '..', '..');
const MIGRATION_PATH = resolve(ROOT, 'drizzle/0061_item_embeddings_onet_element.sql');
const ROLLBACK_PATH = resolve(ROOT, 'scripts/migrations/2026-10-19-blind-rollback.sql');
const VERIFY_PATH = resolve(ROOT, 'scripts/migrations/2026-10-19-blind-verify.sql');

const stripTx = (raw: string) => raw.split('\n').filter(l => l.trim() !== 'BEGIN;' && l.trim() !== 'COMMIT;').join('\n');
const stripVerify = (raw: string) => raw.split('\n').filter(l => {
  const t = l.trim();
  return t !== '\\set ON_ERROR_STOP on' && t !== 'BEGIN READ ONLY;' && t !== 'ROLLBACK;';
}).join('\n');

const MIGRATION_BODY = existsSync(MIGRATION_PATH) ? stripTx(readFileSync(MIGRATION_PATH, 'utf8')) : null;
const ROLLBACK_BODY = existsSync(ROLLBACK_PATH) ? stripTx(readFileSync(ROLLBACK_PATH, 'utf8')) : null;
const VERIFY_BODY = existsSync(VERIFY_PATH) ? stripVerify(readFileSync(VERIFY_PATH, 'utf8')) : null;

describe('0061 files exist (static, runs always)', () => {
  it.each([MIGRATION_PATH, ROLLBACK_PATH, VERIFY_PATH])('%s exists', (p) => {
    expect(existsSync(p), `expected ${p} to exist`).toBe(true);
  });
  it('the Drizzle schema check mirrors the new kind list', () => {
    const schema = readFileSync(resolve(ROOT, 'lib/db/schema.ts'), 'utf8');
    expect(schema).toMatch(/item_embeddings_kind_check[^\n]*'onet_element'/);
  });
});

describe.skipIf(!isCaScratchDb())('migration 0061 on the CA scratch clone, each case self-contained', () => {
  let pool: Pool;
  beforeAll(() => {
    if (!MIGRATION_BODY || !ROLLBACK_BODY || !VERIFY_BODY) throw new Error('0061 files must exist');
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  });
  afterAll(async () => { await pool?.end(); });

  async function withTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      try { return await fn(c); } finally { await c.query('ROLLBACK'); }
    } finally { c.release(); }
  }
  async function expectFailure(c: PoolClient, text: string): Promise<Error> {
    await c.query('SAVEPOINT sp');
    try {
      await c.query(text);
      throw new Error(`expected failure but succeeded: ${text}`);
    } catch (err) {
      await c.query('ROLLBACK TO SAVEPOINT sp');
      await c.query('RELEASE SAVEPOINT sp');
      return err as Error;
    } 
  }
  const ins = (kind: string) => `INSERT INTO item_embeddings (kind, ref, model, text_hash, vector) VALUES ('${kind}', 'blind-t', 'm', 'h', ARRAY[1.0]::real[])`;

  it('precondition: pre-0061 rejects kind onet_element', async () => {
    await withTx(async (c) => {
      const err = await expectFailure(c, ins('onet_element'));
      expect(err.message).toMatch(/item_embeddings_kind_check/);
    });
  });

  it('after the body: onet_element is accepted; the old kinds still are; a bogus kind is not', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await c.query(ins('onet_element'));
      await c.query(`INSERT INTO item_embeddings (kind, ref, model, text_hash, vector) VALUES ('bundle_card','blind-t','m','h',ARRAY[1.0]::real[])`);
      const err = await expectFailure(c, ins('bogus'));
      expect(err.message).toMatch(/item_embeddings_kind_check/);
    });
  });

  it('migration body then verify body completes without error', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await expect(c.query(VERIFY_BODY!)).resolves.toBeDefined();
    });
  });

  it('verify body fails before the migration', async () => {
    await withTx(async (c) => {
      await c.query('SAVEPOINT v');
      await expect(c.query(VERIFY_BODY!)).rejects.toThrow(/0061 verify/);
      await c.query('ROLLBACK TO SAVEPOINT v');
    });
  });

  it('a second run raises 0061: already applied', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await c.query('SAVEPOINT sp');
      await expect(c.query(MIGRATION_BODY!)).rejects.toThrow(/0061: already applied/);
      await c.query('ROLLBACK TO SAVEPOINT sp');
    });
  });

  it('rollback deletes onet_element rows, keeps others, restores the old check', async () => {
    await withTx(async (c) => {
      await c.query(MIGRATION_BODY!);
      await c.query(ins('onet_element'));
      await c.query(`INSERT INTO item_embeddings (kind, ref, model, text_hash, vector) VALUES ('bundle_card','blind-keep','m','h',ARRAY[1.0]::real[])`);
      await c.query(ROLLBACK_BODY!);
      const left = (await c.query(`SELECT kind FROM item_embeddings WHERE ref IN ('blind-t','blind-keep') ORDER BY ref`)).rows;
      expect(left).toEqual([{ kind: 'bundle_card' }]);
      const err = await expectFailure(c, ins('onet_element'));
      expect(err.message).toMatch(/item_embeddings_kind_check/);
    });
  });

  it('rollback before the migration raises 0061 is not applied', async () => {
    await withTx(async (c) => {
      await c.query('SAVEPOINT sp');
      await expect(c.query(ROLLBACK_BODY!)).rejects.toThrow(/0061 is not applied/);
      await c.query('ROLLBACK TO SAVEPOINT sp');
    });
  });
});
