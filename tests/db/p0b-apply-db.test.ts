// @vitest-environment node
// Task 8 (competency-catalog P0b plan): rehearsal of the DB half of the
// P0b live-apply runbook — p0b-apply-db.sh and p0b-db-migrated.sh — mirrors
// tests/db/p0a-apply-db.test.ts's structure and gating discipline.
//
// Gated tests run ONLY against gc_curriculum_p0b_pre (task-8 brief
// Resolution 5: "use ONLY gc_curriculum_p0b_pre... inside a flow that
// leaves it pre-0057 afterwards"), AND only with P0B_APPLY_DB_TEST=1.
// None of these tests ever call apply-db.sh in "apply" mode in a way that
// reaches the migration SQL (the DB-name guard trips first in the one
// apply-mode call below), and the one real restore exercised here
// restores gc_curriculum_p0b_pre's own data back onto itself — the DB
// stays pre-0057 both before and after this file runs, satisfying
// Resolution 5 and the global constraint that gc_curriculum_p0b_pre must
// remain pre-0057 forever.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { isP0bPreDb, SCRATCH_DB_PRE } from './p0b/scratch-guard';

const ROOT = resolve(__dirname, '../..');
const APPLY_DB_SH = resolve(ROOT, 'scripts/migrations/p0b-apply-db.sh');
const DB_MIGRATED_SH = resolve(ROOT, 'scripts/migrations/p0b-db-migrated.sh');
const LIVE_APPLY_SH = resolve(ROOT, 'scripts/migrations/2026-10-12-p0b-live-apply.sh');
const LIB_SH = resolve(ROOT, 'scripts/migrations/p0a-lib.sh');
const PGBIN = '/Applications/Postgres.app/Contents/Versions/17/bin';

const RUN = isP0bPreDb() && process.env.P0B_APPLY_DB_TEST === '1';
const DATABASE_URL = process.env.DATABASE_URL ?? '';
// Deliberately unreachable: used to prove a given guard runs BEFORE any
// connection attempt (the check fails for the guard's own reason, not
// because this URL can't connect).
const GARBAGE_DATABASE_URL = 'postgres://nobody:nothing@127.0.0.1:1/does-not-exist';

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

describe('p0b-apply-db.sh / p0b-db-migrated.sh — static checks (always run)', () => {
  it('bash -n accepts all four scripts', () => {
    for (const sh of [APPLY_DB_SH, DB_MIGRATED_SH, LIVE_APPLY_SH, LIB_SH]) {
      expect(() => execFileSync('bash', ['-n', sh], { encoding: 'utf8' })).not.toThrow();
    }
  });
});

// --- pure, no-DB-connection-required checks: rollback mode validates the
// dump argument BEFORE this script ever calls p0a_url_to_pg_env. These run
// with a garbage DATABASE_URL to prove that ordering — if the dump check
// were skipped or ran after the connection attempt, these would instead
// fail with a connection error, not the dump-specific message.
describe('p0b-apply-db.sh — rollback dump validation runs before any DB connection (always run)', () => {
  let tmp: string;
  beforeAll(() => { tmp = mkdtempSync(join(tmpdir(), 'p0b-apply-db-pure-')); });
  afterAll(() => { rmSync(tmp, { recursive: true, force: true }); });

  it('refuses a dump whose basename does not match pre-apply-*.dump', () => {
    const badName = join(tmp, 'not-the-right-name.dump');
    writeFileSync(badName, 'anything');
    const res = runScript(APPLY_DB_SH, [SCRATCH_DB_PRE, tmp, 'rollback', badName], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/does not match pre-apply-\*\.dump/);
  });

  it('rollback mode requires a 4th argument', () => {
    const res = runScript(APPLY_DB_SH, [SCRATCH_DB_PRE, tmp, 'rollback'], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/requires <pre-apply-dump-path>/);
  });

  it('apply mode refuses a 4th argument', () => {
    const res = runScript(APPLY_DB_SH, [SCRATCH_DB_PRE, tmp, 'apply', join(tmp, 'pre-apply-x.dump')], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/takes no 4th argument/);
  });

  it('refuses an unreadable / non-pg_dump "dump" even if its name matches the pattern', () => {
    const f = join(tmp, 'pre-apply-not-a-real-dump.dump');
    execFileSync('bash', ['-c', `printf x | gzip > "${f}"`]);
    const res = runScript(APPLY_DB_SH, [SCRATCH_DB_PRE, tmp, 'rollback', f], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/failed backup verification/);
  });
});

describe.skipIf(!RUN)('p0b-apply-db.sh (task-8) on gc_curriculum_p0b_pre', () => {
  let backupDir: string;

  async function withClient<T>(fn: (c: Client) => Promise<T>): Promise<T> {
    const c = new Client({ connectionString: DATABASE_URL });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.end();
    }
  }

  // sub_competencies + snapshot_target_coverage both exist in the
  // pre-0057 shape that gc_curriculum_p0b_pre is pinned to forever, so a
  // hash over both proves "the restore changed nothing" regardless of
  // whether sub_competency_map (post-0057) exists.
  const contentHash = (): Promise<string> =>
    withClient(async (c) => (await c.query<{ h: string }>(`
      SELECT md5(string_agg(t, '' ORDER BY t)) AS h FROM (
        SELECT (s.*)::text AS t FROM sub_competencies s
        UNION ALL
        SELECT (c.*)::text AS t FROM snapshot_target_coverage c
      ) x
    `)).rows[0]!.h);

  beforeAll(() => {
    backupDir = mkdtempSync(join(tmpdir(), 'p0b-apply-db-test-'));
  });

  afterAll(() => {
    rmSync(backupDir, { recursive: true, force: true });
  });

  it('refuses when the expected database name does not match — nothing touched (apply mode; guard trips before any backup or SQL)', async () => {
    const before = await contentHash();
    const res = runScript(APPLY_DB_SH, ['definitely_not_the_pre_db', backupDir, 'apply'], { DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/refusing: connected to database/);
    expect(await contentHash()).toBe(before);
  });

  it('refuses when another session is open — nothing touched', async () => {
    const before = await contentHash();
    const { Pool } = await import('pg');
    const holder = new Pool({ connectionString: DATABASE_URL, max: 1 });
    const holderQuery = holder.query('SELECT pg_sleep(1.5)');
    try {
      await new Promise((r) => setTimeout(r, 300));
      const res = runScript(APPLY_DB_SH, [SCRATCH_DB_PRE, backupDir, 'apply'], { DATABASE_URL });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/refusing: other sessions are connected/);
    } finally {
      await holderQuery;
      await holder.end();
    }
    expect(await contentHash()).toBe(before);
  });

  it('p0b-db-migrated.sh refuses when DATABASE_URL points at a different database than expected', () => {
    const res = runScript(DB_MIGRATED_SH, ['definitely_not_the_pre_db'], { DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/refusing: connected to database '.*', expected 'definitely_not_the_pre_db' — state UNKNOWN/);
    expect(res.stdout.trim()).toBe('');
  });

  it('p0b-db-migrated.sh prints "f" for gc_curriculum_p0b_pre (sub_competency_map never exists there)', () => {
    const res = runScript(DB_MIGRATED_SH, [SCRATCH_DB_PRE], { DATABASE_URL });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('f');
  });

  it('rollback mode rejects a real SCHEMA-ONLY dump of this database — no TABLE DATA for snapshot_target_coverage', () => {
    const f = join(backupDir, 'pre-apply-schema-only.dump');
    const dumpRes = runScript(`${PGBIN}/pg_dump`, ['-Fc', '--no-owner', '-s', '-f', f, DATABASE_URL]);
    expect(dumpRes.status).toBe(0);
    // Garbage URL: proves this is still caught before any connection is made.
    const res = runScript(APPLY_DB_SH, [SCRATCH_DB_PRE, backupDir, 'rollback', f], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/failed backup verification/);
  });

  it('rollback mode accepts a real FULL dump of this database past dump validation (fails later, for the unrelated reason of a garbage DATABASE_URL)', () => {
    const f = join(backupDir, `pre-apply-full-${Date.now()}.dump`);
    const dumpRes = runScript(`${PGBIN}/pg_dump`, ['-Fc', '--no-owner', '-f', f, DATABASE_URL]);
    expect(dumpRes.status).toBe(0);
    const res = runScript(APPLY_DB_SH, [SCRATCH_DB_PRE, backupDir, 'rollback', f], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/confirmed: rollback dump .* matches pre-apply-\*\.dump and passes backup verification/);
    expect(res.stderr).not.toMatch(/failed backup verification/);
    expect(res.stderr).not.toMatch(/does not match pre-apply/);
  });

  it('rollback takes a fresh pre-restore backup of the CURRENT state before restoring, and DB content is unchanged afterward (restoring the same data back onto itself)', async () => {
    const before = await contentHash();
    const fixtureDump = join(backupDir, `pre-apply-fixture-${Date.now()}.dump`);
    const dumpRes = runScript(`${PGBIN}/pg_dump`, ['-Fc', '--no-owner', '-f', fixtureDump, DATABASE_URL]);
    expect(dumpRes.status).toBe(0);

    const beforeFiles = new Set(readdirSync(backupDir));
    const res = runScript(APPLY_DB_SH, [SCRATCH_DB_PRE, backupDir, 'rollback', fixtureDump], { DATABASE_URL });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/pre-rollback backup of current state verified:/);
    expect(res.stdout).toMatch(/p0b-apply-db\.sh: rollback on '.*' complete/);

    const newFiles = readdirSync(backupDir).filter((f) => !beforeFiles.has(f));
    const safetyBackup = newFiles.find((f) => /^pre-rollback-.*\.dump$/.test(f));
    expect(safetyBackup).toBeDefined();

    expect(await contentHash()).toBe(before);
  });
});
