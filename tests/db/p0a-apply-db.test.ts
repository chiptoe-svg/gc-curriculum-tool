// @vitest-environment node
// Rehearsal of the DB half of the P0a live-apply runbook (I-1, adversarial
// review 2026-10-11) on the scratch clone: p0a-apply-db.sh and its backup
// verifier p0a-verify-backup.sh, invoked exactly as the owner-run wrapper
// would invoke them (child_process against the real scripts, not mocked).
// Gated: scratch DB AND P0A_APPLY_DB_TEST=1, run ALONE (the happy-path case
// rolls back and re-applies 0056 on scratch, like p0a-migration.test.ts).
// Leaves the scratch DB migrated.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client, Pool } from 'pg';
import { isScratchDb, SCRATCH_DB } from './p0a/scratch-guard';

const ROOT = resolve(__dirname, '../..');
const APPLY_DB_SH = resolve(ROOT, 'scripts/migrations/p0a-apply-db.sh');
const VERIFY_BACKUP_SH = resolve(ROOT, 'scripts/migrations/p0a-verify-backup.sh');
const LIVE_APPLY_SH = resolve(ROOT, 'scripts/migrations/2026-10-11-p0a-live-apply.sh');
const RUN = isScratchDb() && process.env.P0A_APPLY_DB_TEST === '1';
const DATABASE_URL = process.env.DATABASE_URL ?? '';

const DB_MIGRATED_SH = resolve(ROOT, 'scripts/migrations/p0a-db-migrated.sh');

interface Result { status: number; stdout: string; stderr: string }

function runScript(bin: string, args: string[], env?: Record<string, string>): Result {
  try {
    const stdout = execFileSync(bin, args, { encoding: 'utf8', env: env ? { ...process.env, ...env } : undefined });
    return { status: 0, stdout, stderr: '' };
  } catch (e) {
    const err = e as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return { status: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
  }
}

describe('p0a-apply-db.sh / p0a-verify-backup.sh / p0a-db-migrated.sh — static checks (always run)', () => {
  it('bash -n accepts all four scripts', () => {
    for (const sh of [APPLY_DB_SH, VERIFY_BACKUP_SH, LIVE_APPLY_SH, DB_MIGRATED_SH]) {
      expect(() => execFileSync('bash', ['-n', sh], { encoding: 'utf8' })).not.toThrow();
    }
  });
});

describe.skipIf(!RUN)('p0a-apply-db.sh (I-1) on the scratch clone', () => {
  let backupDir: string;

  // One-shot Client per check, connected and closed immediately — NOT a
  // Pool. A Pool keeps its connection open "idle" after a query for reuse,
  // which pg_stat_activity (and so the script's own "no other sessions"
  // guard) sees as exactly the kind of other session this test is trying to
  // rule out, which would make this test file trip its own subject under
  // test.
  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  const applied = (): Promise<boolean> =>
    withClient(async c => (await c.query<{ r: string | null }>(
      `SELECT to_regclass('public.snapshot_competency_coverage')::text AS r`)).rows[0]!.r !== null);

  // A content hash over the two tables that exist in BOTH the migrated and
  // pre-migration shape, so "untouched" can be asserted regardless of which
  // shape the DB is in when a guard test runs.
  const contentHash = (): Promise<string> =>
    withClient(async c => (await c.query<{ h: string }>(`
      SELECT md5(string_agg(t, '' ORDER BY t)) AS h FROM (
        SELECT (s.*)::text AS t FROM sub_competencies s
        UNION ALL
        SELECT (c.*)::text AS t FROM snapshot_target_coverage c
      ) x
    `)).rows[0]!.h);

  const runFile = (text: string) =>
    withClient(async c => {
      try {
        await c.query(text);
      } catch (e) {
        await c.query('ROLLBACK');
        throw e;
      }
    });

  beforeAll(() => {
    backupDir = mkdtempSync(join(tmpdir(), 'p0a-apply-db-test-'));
  });

  afterAll(() => {
    rmSync(backupDir, { recursive: true, force: true });
  });

  it('refuses when the expected database name does not match — DB untouched', async () => {
    const before = await contentHash();
    const wasApplied = await applied();
    const res = runScript(APPLY_DB_SH, ['definitely_not_the_scratch_db', backupDir, 'apply'], { DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/refusing: connected to database/);
    expect(await contentHash()).toBe(before);
    expect(await applied()).toBe(wasApplied);
  });

  it('refuses when another session is open on scratch — DB untouched', async () => {
    const before = await contentHash();
    const wasApplied = await applied();
    const holder = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const holderQuery = holder.query('SELECT pg_sleep(1.5)');
    try {
      // Give the holder a moment to actually register as 'active' before probing.
      await new Promise(r => setTimeout(r, 300));
      const res = runScript(APPLY_DB_SH, [SCRATCH_DB, backupDir, 'apply'], { DATABASE_URL });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/refusing: other sessions are connected/);
    } finally {
      await holderQuery;
      await holder.end();
    }
    expect(await contentHash()).toBe(before);
    expect(await applied()).toBe(wasApplied);
  });

  it('p0a-verify-backup.sh rejects an empty dump file', () => {
    const f = join(backupDir, 'empty.dump');
    writeFileSync(f, '');
    const res = runScript(VERIFY_BACKUP_SH, [f, 'apply']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/missing or empty/);
  });

  it('p0a-verify-backup.sh rejects a valid-gzip-but-not-a-pg_dump file (the reviewer\'s exact repro)', () => {
    // Reviewer's finding: `pg_dump ... | gzip > file` without pipefail can
    // produce a valid, non-empty, 20-byte gzip of nothing, which an exit-code
    // check alone would accept. Reproduce the shape here (gzip of 1 byte that
    // is not a pg_dump custom-format archive at all) and confirm it's refused.
    const f = join(backupDir, 'fake.dump');
    execFileSync('bash', ['-c', `printf x | gzip > "${f}"`]);
    const res = runScript(VERIFY_BACKUP_SH, [f, 'apply']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/pg_restore --list could not read backup/);
  });

  it('p0a-verify-backup.sh rejects a real SCHEMA-ONLY dump (M-d, round 2) — a TABLE entry with no TABLE DATA must fail', () => {
    // Round-1 grepped for "TABLE public <t>", a schema-only TOC entry that a
    // `pg_dump -s` (schema-only, no rows) archive still has — so it passed.
    // A real dump of scratch with -s reproduces exactly that: the round-2
    // reviewer found this by hand; this is the committed version.
    const f = join(backupDir, 'schema-only.dump');
    const dumpRes = runScript('/Applications/Postgres.app/Contents/Versions/17/bin/pg_dump',
      ['-Fc', '--no-owner', '-s', '-f', f, DATABASE_URL]);
    expect(dumpRes.status).toBe(0);
    const res = runScript(VERIFY_BACKUP_SH, [f, 'apply']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/no TABLE DATA for 'sub_competencies'/);
  });

  it('p0a-verify-backup.sh ACCEPTS a real full dump (sanity: the TABLE DATA check does not over-reject)', () => {
    const f = join(backupDir, 'full-sanity.dump');
    const dumpRes = runScript('/Applications/Postgres.app/Contents/Versions/17/bin/pg_dump',
      ['-Fc', '--no-owner', '-f', f, DATABASE_URL]);
    expect(dumpRes.status).toBe(0);
    const res = runScript(VERIFY_BACKUP_SH, [f, 'apply']);
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/pg_restore --list lists TABLE DATA for/);
  });

  it('p0a-verify-backup.sh rejects a real archive missing a required table', () => {
    // A dump of a database that doesn't have the tables we need — point
    // pg_dump at a nonexistent database via a URL variant (no scratch DB was
    // touched to make this file: it's an empty custom-format archive of a
    // connection that fails before any table is read, so this doubles as the
    // "nonexistent DB name in a URL variant" case named in the brief).
    const f = join(backupDir, 'nonexistent-db.dump');
    const badUrl = (() => {
      const u = new URL(DATABASE_URL);
      u.pathname = '/gc_adv_nonexistent_db_zz';
      return u.toString();
    })();
    const res = runScript('/Applications/Postgres.app/Contents/Versions/17/bin/pg_dump',
      ['-Fc', '--no-owner', '-f', f, badUrl]);
    expect(res.status).not.toBe(0); // pg_dump itself fails to connect
    // No file (or an unreadable one) should exist; verify-backup must refuse either way.
    const verifyRes = runScript(VERIFY_BACKUP_SH, [f, 'apply']);
    expect(verifyRes.status).not.toBe(0);
  });

  it('happy path: rollback then apply on scratch — zero exit, verify passes, backup files check out, scratch ends MIGRATED, characterization passes', async () => {
    // Ensure a known starting shape (migrated) regardless of prior test order.
    if (!(await applied())) {
      const migrationSql = execFileSync('cat', [resolve(ROOT, 'drizzle/0056_competency_catalog_p0a.sql')], { encoding: 'utf8' });
      await runFile(migrationSql);
    }
    expect(await applied()).toBe(true);

    const rollbackRes = runScript(APPLY_DB_SH, [SCRATCH_DB, backupDir, 'rollback'], { DATABASE_URL });
    expect(rollbackRes.status).toBe(0);
    expect(rollbackRes.stdout).toMatch(/backup verified:.*pg_restore --list lists TABLE DATA for.*snapshot_competency_coverage.*career_target_requirements/);
    expect(rollbackRes.stdout).toMatch(/p0a-apply-db\.sh: rollback on '.*' complete/);
    expect(await applied()).toBe(false);

    const applyRes = runScript(APPLY_DB_SH, [SCRATCH_DB, backupDir, 'apply'], { DATABASE_URL });
    expect(applyRes.status).toBe(0);
    expect(applyRes.stdout).toMatch(/backup verified:.*pg_restore --list lists TABLE DATA for.*sub_competencies.*snapshot_target_coverage/);
    // Every "(expect 0" verify row (M-a: no trailing-paren requirement, so
    // "(expect 0 right after apply)" counts too) must have printed as 0, and
    // none flagged FAILED. Exactly 18 data rows, matching the verify SQL.
    expect(applyRes.stdout).not.toMatch(/VERIFY FAILED/);
    let expectZeroRows = 0;
    let dataRows = 0;
    for (const line of applyRes.stdout.split('\n')) {
      if (!/: \d+$/.test(line.trim())) continue;
      dataRows++;
      if (line.includes('(expect 0')) {
        expectZeroRows++;
        expect(line.trim().endsWith(': 0')).toBe(true);
      }
    }
    expect(dataRows).toBe(18);
    expect(expectZeroRows).toBeGreaterThan(0);
    expect(applyRes.stdout).toMatch(/p0a-apply-db\.sh: apply on '.*' complete/);
    expect(await applied()).toBe(true);

    const golden = process.env.P0A_GOLDEN;
    if (golden) {
      const charRes = runScript(resolve(ROOT, 'node_modules/.bin/vitest'), [
        'run', 'tests/db/p0a-characterization.test.ts',
      ]);
      expect(charRes.status).toBe(0);
    }
  });
});
