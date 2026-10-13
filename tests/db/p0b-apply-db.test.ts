// @vitest-environment node
// Task 8 (competency-catalog P0b plan): rehearsal of the DB half of the
// P0b live-apply runbook — p0b-apply-db.sh and p0b-db-migrated.sh — mirrors
// tests/db/p0a-apply-db.test.ts's structure and gating discipline.
//
// Gated tests run ONLY against gc_curriculum_p0b_pre (task-8 brief
// Resolution 5: "use ONLY gc_curriculum_p0b_pre... inside a flow that
// leaves it pre-0057 afterwards"), AND only with P0B_APPLY_DB_TEST=1.
// None of these tests ever call apply-db.sh in a way that opens a real
// connection and mutates gc_curriculum_p0b_pre's own data — the DB-name
// and other-sessions guards trip first in the "apply" mode calls below,
// and the "rollback" mode calls here all use a deliberately unreachable
// DATABASE_URL, so they only ever exercise the pure dump-validation layer
// (which runs before any connection) against dumps whose content happens
// to be read from gc_curriculum_p0b_pre. That database is a read-only
// SOURCE here, never a target.
//
// Fix round 1: rollback mode no longer restores onto the database it was
// invoked against (see p0b-apply-db.sh's header) — it restores into a
// brand-new database, verifies it, then swaps it in by renaming two whole
// databases. The end-to-end real-DB exercise of that swap therefore lives
// in tests/db/p0b-rollback-swap.test.ts, against a disposable
// gc_curriculum_p0b_rbtest* clone created and torn down by that file —
// never against gc_curriculum_p0b_pre or gc_curriculum_p0b_scratch, which
// the controller ruling for fix round 1 explicitly rules out as rollback
// targets (the swap renames whatever EXPECTED_DB names, and these two
// fixtures are shared by other tasks that depend on their exact identity
// persisting).
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { isP0bPreDb } from './p0b/scratch-guard';

const ROOT = resolve(__dirname, '../..');
const APPLY_DB_SH = resolve(ROOT, 'scripts/migrations/p0b-apply-db.sh');
const DB_MIGRATED_SH = resolve(ROOT, 'scripts/migrations/p0b-db-migrated.sh');
const LIVE_APPLY_SH = resolve(ROOT, 'scripts/migrations/2026-10-12-p0b-live-apply.sh');
const LIB_SH = resolve(ROOT, 'scripts/migrations/p0a-lib.sh');
const PREFLIGHT_SH = resolve(ROOT, 'scripts/migrations/p0b-preflight.sh');
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
  it('bash -n accepts all five scripts', () => {
    for (const sh of [APPLY_DB_SH, DB_MIGRATED_SH, LIVE_APPLY_SH, LIB_SH, PREFLIGHT_SH]) {
      expect(() => execFileSync('bash', ['-n', sh], { encoding: 'utf8' })).not.toThrow();
    }
  });
});

// --- fix round 2 (Important, reviewer finding): the database-name
// allowlist (p0b_check_allowed_db_name, p0a-lib.sh) must live IN the
// scripts themselves, not only in the TS test helpers that happen to
// call them. Checked before any connection (DATABASE_URL is garbage
// here, so a pass-through would fail differently/later, not with this
// message), so these run unconditionally — no DB needed.
describe('p0b-apply-db.sh / p0b-db-migrated.sh — database-name allowlist enforced in the scripts (fix round 2, always run)', () => {
  const refusedNames = [
    'gc_curriculum_p0b_pre',
    'rag_core',
    'gc_curriculum_p0b_rbtest"; DROP DATABASE gc_curriculum; --',
    // Fix round 3 (Minor 4): a single-quote variant alongside the
    // existing double-quote one — belt-and-braces proof that the
    // allowlist regex itself (not a particular quoting style) is what's
    // rejecting these, on top of the psql `:"var"`/`:'var'` substitution
    // fix round 2 already applied.
    "gc_curriculum_p0b_rbtest'; DROP DATABASE gc_curriculum; --",
    'gc_curriculum2',
  ];

  it.each(refusedNames)("p0b-apply-db.sh refuses database name '%s' before any connection", (name) => {
    const res = runScript(APPLY_DB_SH, [name, '/nonexistent', 'apply'], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/refusing: '.*' is not on the allowed database-name list/);
  });

  it.each(refusedNames)("p0b-db-migrated.sh refuses database name '%s' before any connection", (name) => {
    const res = runScript(DB_MIGRATED_SH, [name], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/refusing: '.*' is not on the allowed database-name list/);
    expect(res.stdout.trim()).toBe('');
  });

  it('p0b-apply-db.sh accepts the exact live name past the allowlist (fails later, for the unrelated reason of a garbage DATABASE_URL)', () => {
    const res = runScript(APPLY_DB_SH, ['gc_curriculum', '/nonexistent', 'apply'], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).not.toMatch(/not on the allowed database-name list/);
  });

  it('p0b-apply-db.sh accepts a gc_curriculum_p0b_rbtest* name past the allowlist (fails later, for the unrelated reason of a garbage DATABASE_URL)', () => {
    const res = runScript(APPLY_DB_SH, ['gc_curriculum_p0b_rbtest_whatever', '/nonexistent', 'apply'], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).not.toMatch(/not on the allowed database-name list/);
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
    const res = runScript(APPLY_DB_SH, ['gc_curriculum', tmp, 'rollback', badName], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/does not match pre-apply-\*\.dump/);
  });

  it('rollback mode requires a 4th argument', () => {
    const res = runScript(APPLY_DB_SH, ['gc_curriculum', tmp, 'rollback'], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/requires <pre-apply-dump-path>/);
  });

  it('apply mode refuses a 4th argument', () => {
    const res = runScript(APPLY_DB_SH, ['gc_curriculum', tmp, 'apply', join(tmp, 'pre-apply-x.dump')], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).toBe(2);
    expect(res.stderr).toMatch(/takes no 4th argument/);
  });

  it('refuses an unreadable / non-pg_dump "dump" even if its name matches the pattern', () => {
    const f = join(tmp, 'pre-apply-not-a-real-dump.dump');
    execFileSync('bash', ['-c', `printf x | gzip > "${f}"`]);
    const res = runScript(APPLY_DB_SH, ['gc_curriculum', tmp, 'rollback', f], { DATABASE_URL: GARBAGE_DATABASE_URL });
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
    // 'gc_curriculum' is on the fix-round-2 allowlist (so it passes that
    // check) but is not what DATABASE_URL actually connects to here (the
    // real gc_curriculum_p0b_pre) — so this still reaches and trips the
    // "connected to X, expected Y" guard, not the allowlist.
    const res = runScript(APPLY_DB_SH, ['gc_curriculum', backupDir, 'apply'], { DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/refusing: connected to database/);
    expect(await contentHash()).toBe(before);
  });

  it('p0b-db-migrated.sh refuses when DATABASE_URL points at a different database than expected', () => {
    const res = runScript(DB_MIGRATED_SH, ['gc_curriculum'], { DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/refusing: connected to database '.*', expected 'gc_curriculum' — state UNKNOWN/);
    expect(res.stdout.trim()).toBe('');
  });

  // NOTE (fix round 2): there used to be two more tests here — "refuses
  // when another session is open" and "p0b-db-migrated.sh prints f for
  // gc_curriculum_p0b_pre" — that needed EXPECTED_DB to literally equal
  // the real database DATABASE_URL connects to (gc_curriculum_p0b_pre),
  // to get past the DB-name guard and reach the guard/probe under test.
  // The fix-round-2 allowlist (p0b_check_allowed_db_name, checked before
  // any connection) now refuses gc_curriculum_p0b_pre outright — by
  // design: the controller ruling requires these scripts to accept
  // nothing but 'gc_curriculum' and gc_curriculum_p0b_rbtest*, full stop.
  // That makes both tests structurally impossible to run for real against
  // gc_curriculum_p0b_pre any more. The underlying guard/probe logic
  // itself is unchanged (identical to_regclass/pg_stat_activity queries
  // p0a's own proven implementation uses) and is exercised for real
  // elsewhere: tests/db/p0b-rollback-swap.test.ts's end-to-end test
  // relies on this exact "no other sessions" guard passing and this
  // exact verification query succeeding against its gc_curriculum_p0b_
  // rbtest fixture on every run.

  it('rollback mode rejects a real SCHEMA-ONLY dump of this database — no TABLE DATA for snapshot_target_coverage', () => {
    const f = join(backupDir, 'pre-apply-schema-only.dump');
    const dumpRes = runScript(`${PGBIN}/pg_dump`, ['-Fc', '--no-owner', '-s', '-f', f, DATABASE_URL]);
    expect(dumpRes.status).toBe(0);
    // Garbage URL: proves this is still caught before any connection is made.
    const res = runScript(APPLY_DB_SH, ['gc_curriculum', backupDir, 'rollback', f], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/failed backup verification/);
  });

  it('rollback mode accepts a real FULL dump of this database past dump validation (fails later, for the unrelated reason of a garbage DATABASE_URL)', () => {
    const f = join(backupDir, `pre-apply-full-${Date.now()}.dump`);
    const dumpRes = runScript(`${PGBIN}/pg_dump`, ['-Fc', '--no-owner', '-f', f, DATABASE_URL]);
    expect(dumpRes.status).toBe(0);
    const res = runScript(APPLY_DB_SH, ['gc_curriculum', backupDir, 'rollback', f], { DATABASE_URL: GARBAGE_DATABASE_URL });
    expect(res.status).not.toBe(0);
    expect(res.stdout).toMatch(/confirmed: rollback dump .* matches pre-apply-\*\.dump and passes backup verification/);
    expect(res.stderr).not.toMatch(/failed backup verification/);
    expect(res.stderr).not.toMatch(/does not match pre-apply/);
  });

  // NOTE (fix round 1): there used to be a test here that ran apply-db.sh
  // in rollback mode for real against gc_curriculum_p0b_pre (restoring its
  // own data back onto itself under the old `pg_restore --clean`
  // approach). That approach is gone — rollback mode now creates a new
  // database and swaps it in by renaming, which would rename
  // gc_curriculum_p0b_pre itself. The controller ruling for fix round 1
  // explicitly disallows gc_curriculum_p0b_pre (and gc_curriculum_p0b_
  // scratch) as a rollback target, so the real end-to-end exercise of the
  // swap moved to tests/db/p0b-rollback-swap.test.ts, against its own
  // disposable gc_curriculum_p0b_rbtest* clone.
});
