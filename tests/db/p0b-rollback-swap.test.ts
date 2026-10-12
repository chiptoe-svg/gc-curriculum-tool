// @vitest-environment node
// Fix round 1 (task 8, competency-catalog P0b plan, 2026-10-12): real,
// non-stubbed exercise of p0b-apply-db.sh's rollback mode after the
// create-new-db-and-swap rewrite (see that script's header for the bug
// this replaced: `pg_restore --clean` of a pre-0057 dump onto a
// post-0057 database cannot work, because 0057's sub_competency_map has
// an FK to sub_competencies that the pre-0057 dump knows nothing about —
// reviewer-reproduced, Critical).
//
// Gated behind P0B_ROLLBACK_SWAP_TEST=1 AND DATABASE_URL naming
// gc_curriculum_p0b_scratch (isP0bMainDb()) — the same "every DB test
// refuses to run unless DATABASE_URL names gc_curriculum_p0b_scratch"
// discipline every other P0b DB test in this plan uses. That URL's
// host/credentials (never gc_curriculum_p0b_scratch's own name) are
// reused to construct every throwaway database this file creates — all
// of them named gc_curriculum_p0b_rbtest* and validated through
// isP0bRollbackTestDb() before every create/drop/rename, since rollback
// mode now CREATEs and RENAMEs whole databases and a name typo here would
// be a lot more dangerous than a typo in an ordinary query. Per the
// controller ruling for this fix round: "You may not use live or the two
// P0b scratch databases as targets" — gc_curriculum_p0b_scratch and
// gc_curriculum_p0b_pre are read-only SOURCES here (pg_dump only), never
// something this file creates, renames, or drops.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';
import { isP0bMainDb, isP0bRollbackTestDb, ROLLBACK_TEST_DB, SCRATCH_DB_PRE } from './p0b/scratch-guard';

const ROOT = resolve(__dirname, '../..');
const APPLY_DB_SH = resolve(ROOT, 'scripts/migrations/p0b-apply-db.sh');
const DB_MIGRATED_SH = resolve(ROOT, 'scripts/migrations/p0b-db-migrated.sh');
const PGBIN = '/Applications/Postgres.app/Contents/Versions/17/bin';

const RUN = isP0bMainDb() && process.env.P0B_ROLLBACK_SWAP_TEST === '1';
// The scratch clone's own URL doubles as this file's connection source:
// same host/role, just a different dbname per call (see withDbName).
const SCRATCH_URL = process.env.DATABASE_URL ?? '';

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

function withDbName(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

function queryOne(url: string, sql: string): string {
  return execFileSync(`${PGBIN}/psql`, [url, '-X', '-At', '-c', sql], { encoding: 'utf8' }).trim();
}

function runMaint(anyUrl: string, sql: string) {
  execFileSync(`${PGBIN}/psql`, [withDbName(anyUrl, 'postgres'), '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql]);
}

function assertRollbackTestName(name: string) {
  if (!isP0bRollbackTestDb(name)) {
    throw new Error(`refusing to touch '${name}': not a gc_curriculum_p0b_rbtest* disposable fixture`);
  }
}

/** DROP DATABASE IF EXISTS, after terminating any lingering backends. Safe to call on a name that doesn't exist. */
function dropDatabaseForce(anyUrl: string, name: string) {
  assertRollbackTestName(name);
  try {
    runMaint(anyUrl, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}'`);
  } catch {
    // no-op: nothing to terminate, or the database doesn't exist yet.
  }
  runMaint(anyUrl, `DROP DATABASE IF EXISTS "${name}"`);
}

/**
 * Polls until nothing else is connected to `url`'s database (besides this
 * polling connection itself), or `timeoutMs` elapses. Discovered needed in
 * fix round 3: the `pg_dump | psql` pipe below (and any other
 * execFileSync'd psql) can return to Node a few milliseconds before
 * Postgres itself has finished tearing down that backend's connection —
 * a genuine, observed race, not a hypothetical one (it intermittently
 * made the very next p0b-apply-db.sh invocation's own "no other
 * sessions" guard see that still-closing connection and refuse). Blocking
 * until the server confirms quiescence, rather than a fixed sleep, is
 * exact and still fast on the common case (usually resolves on the first
 * check).
 */
function waitForNoOtherSessions(url: string, timeoutMs = 5000): void {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const count = queryOne(url, 'SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()');
    if (count === '0') return;
    if (Date.now() >= deadline) return; // best-effort: let the caller's own guard surface whatever is still there
  }
}

/** Full clone of sourceUrl's database into a fresh gc_curriculum_p0b_rbtest* database. */
function cloneDatabase(sourceUrl: string, targetName: string) {
  assertRollbackTestName(targetName);
  dropDatabaseForce(sourceUrl, targetName);
  runMaint(sourceUrl, `CREATE DATABASE "${targetName}"`);
  const targetUrl = withDbName(sourceUrl, targetName);
  execFileSync('bash', ['-c', 'set -euo pipefail; "$PG_DUMP" --no-owner --no-privileges "$SRC" | "$PG_PSQL" "$DST" -X -q -v ON_ERROR_STOP=1'], {
    env: { ...process.env, SRC: sourceUrl, DST: targetUrl, PG_DUMP: `${PGBIN}/pg_dump`, PG_PSQL: `${PGBIN}/psql` },
  });
  waitForNoOtherSessions(targetUrl);
}

/** Every gc_curriculum_p0b_rbtest* database currently on the server (one per line from a plain `datname` query). */
function listRollbackTestDatabases(anyUrl: string): string[] {
  const out = queryOne(anyUrl, "SELECT datname FROM pg_database WHERE datname LIKE 'gc_curriculum_p0b_rbtest%' ORDER BY datname");
  return out.split('\n').map((s) => s.trim()).filter(Boolean);
}

/**
 * Fix round 2 (Minor 4, reviewer-reproduced): drops EVERY
 * gc_curriculum_p0b_rbtest* database currently on the server, not just
 * ones a test run happened to track by name — a failing path (a thrown
 * assertion between CREATE and recording the name) could otherwise leak
 * one past a plain "drop what I tracked" loop forever. Each name is
 * still filtered through isP0bRollbackTestDb() (belt-and-braces; the
 * LIKE pattern above already narrows to this family) before being
 * dropped.
 */
function sweepLeakedRollbackTestDatabases(anyUrl: string): void {
  for (const name of listRollbackTestDatabases(anyUrl)) {
    if (!isP0bRollbackTestDb(name)) continue;
    try {
      dropDatabaseForce(anyUrl, name);
    } catch {
      // best-effort; move on to the next leaked name.
    }
  }
}

describe.skipIf(!RUN)('p0b-apply-db.sh rollback (fix round 1): restore-into-new-db-then-swap, real DB', () => {
  let preUrl: string;
  let tmp: string;
  const createdDbs = new Set<string>();

  beforeAll(() => {
    preUrl = withDbName(SCRATCH_URL, SCRATCH_DB_PRE);
    tmp = mkdtempSync(join(tmpdir(), 'p0b-rollback-swap-test-'));
  });

  afterAll(() => {
    for (const name of createdDbs) {
      try {
        dropDatabaseForce(SCRATCH_URL, name);
      } catch {
        // best-effort cleanup; a leaked gc_curriculum_p0b_rbtest* fixture
        // is harmless and reusable next run (cloneDatabase/dropDatabaseForce
        // both drop-before-create anyway).
      }
    }
    // Belt-and-braces beyond the tracked-name loop above: sweep the
    // server for anything matching the family that createdDbs might have
    // missed (see sweepLeakedRollbackTestDatabases).
    try {
      sweepLeakedRollbackTestDatabases(SCRATCH_URL);
    } catch {
      // best-effort; if even the LIST query itself fails, there's nothing more to do here.
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it('end-to-end: rollback swaps a post-0057 target back to pre-0057, keeps the migrated copy as a reversible fallback, and the undo renames restore it', () => {
    const target = ROLLBACK_TEST_DB;
    expect(isP0bRollbackTestDb(target)).toBe(true);
    createdDbs.add(target);
    cloneDatabase(SCRATCH_URL, target);
    const targetUrl = withDbName(SCRATCH_URL, target);

    // Sanity: the clone is genuinely post-0057 before we touch anything.
    expect(queryOne(targetUrl, "SELECT to_regclass('public.sub_competency_map') IS NOT NULL")).toBe('t');
    expect(queryOne(targetUrl, 'SELECT count(*) FROM career_target_requirements')).toBe('35');

    const dumpPath = join(tmp, `pre-apply-${Date.now()}.dump`);
    execFileSync(`${PGBIN}/pg_dump`, ['-Fc', '--no-owner', '-f', dumpPath, preUrl]);

    const res = runScript(APPLY_DB_SH, [target, tmp, 'rollback', dumpPath], { DATABASE_URL: targetUrl });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/swap complete: '.*' is now the restored pre-0057 database/);
    expect(res.stdout).toMatch(/p0b-apply-db\.sh: rollback on '.*' complete/);

    const fallbackMatch = res.stdout.match(/kept, not dropped, as '([^']+)'/);
    expect(fallbackMatch).toBeTruthy();
    const fallbackName = fallbackMatch![1]!;
    expect(fallbackName.startsWith(`${target}_pre_rollback_`)).toBe(true);
    expect(isP0bRollbackTestDb(fallbackName)).toBe(true);
    createdDbs.add(fallbackName);

    // The live-named database is now pre-0057.
    expect(queryOne(targetUrl, "SELECT to_regclass('public.sub_competency_map') IS NOT NULL")).toBe('f');
    expect(queryOne(targetUrl, "SELECT to_regclass('public.snapshot_target_coverage') IS NOT NULL")).toBe('t');
    expect(queryOne(targetUrl, 'SELECT count(*) FROM career_target_requirements')).toBe('36');

    // The fallback holds the untouched, intact migrated database.
    const fallbackUrl = withDbName(SCRATCH_URL, fallbackName);
    expect(queryOne(fallbackUrl, "SELECT to_regclass('public.sub_competency_map') IS NOT NULL")).toBe('t');
    expect(queryOne(fallbackUrl, 'SELECT count(*) FROM career_target_requirements')).toBe('35');

    // --- undo path: the exact two renames the script prints -------------
    const parkedName = `${target}_rollback_${Date.now()}`;
    assertRollbackTestName(parkedName);
    runMaint(SCRATCH_URL, `ALTER DATABASE "${target}" RENAME TO "${parkedName}"`);
    runMaint(SCRATCH_URL, `ALTER DATABASE "${fallbackName}" RENAME TO "${target}"`);
    createdDbs.add(parkedName);

    // Undo complete: the live name is migrated again.
    expect(queryOne(targetUrl, "SELECT to_regclass('public.sub_competency_map') IS NOT NULL")).toBe('t');
    expect(queryOne(targetUrl, 'SELECT count(*) FROM career_target_requirements')).toBe('35');
  });

  it('regression guard (fix round 1, reviewer-reproduced): a --clean restore of a pre-0057 dump onto a post-0057 target fails', () => {
    const target = `${ROLLBACK_TEST_DB}_cleantest`;
    expect(isP0bRollbackTestDb(target)).toBe(true);
    createdDbs.add(target);
    cloneDatabase(SCRATCH_URL, target);
    const targetUrl = withDbName(SCRATCH_URL, target);
    expect(queryOne(targetUrl, "SELECT to_regclass('public.sub_competency_map') IS NOT NULL")).toBe('t');

    const dumpPath = join(tmp, `pre-apply-cleantest-${Date.now()}.dump`);
    execFileSync(`${PGBIN}/pg_dump`, ['-Fc', '--no-owner', '-f', dumpPath, preUrl]);

    // This is exactly what p0b-apply-db.sh used to run before the fix —
    // kept here as a standing regression guard, not through the script
    // (the fixed script no longer has a --clean code path to call).
    const res = runScript(`${PGBIN}/pg_restore`, ['--clean', '--if-exists', '--no-owner', '-d', targetUrl, dumpPath]);
    expect(res.status).not.toBe(0);
    expect(res.stderr + res.stdout).toMatch(/sub_competencies|violat|depend|cannot drop|constraint/i);

    // And the target is left inconsistent, not simply "unchanged" —
    // sub_competency_map survives (its DROP TABLE never got a chance to
    // run before the FK-blocked DROP of sub_competencies upstream of it
    // failed the whole restore), confirming this is the half-restored
    // state the fix round 1 report described, not a clean no-op refusal.
    expect(queryOne(targetUrl, "SELECT to_regclass('public.sub_competency_map') IS NOT NULL")).toBe('t');
  });

  // Fix round 2 (Minor 4, reviewer-reproduced): simulates exactly the leak
  // the reviewer found — a gc_curriculum_p0b_rbtest_rollback_<ts> database
  // that exists on the server but was never recorded in createdDbs (e.g.
  // because the test that created it threw between CREATE and tracking
  // it) — and confirms the afterAll-style sweep finds and drops it by
  // querying pg_database directly, not by relying on the tracked set.
  it('the leaked-database sweep drops a gc_curriculum_p0b_rbtest* database that was never tracked by name', () => {
    const leaked = `${ROLLBACK_TEST_DB}_rollback_${Date.now()}`; // same shape the swap itself generates
    expect(isP0bRollbackTestDb(leaked)).toBe(true);
    dropDatabaseForce(SCRATCH_URL, leaked); // idempotent pre-clean, in case a prior run of this exact test left one
    runMaint(SCRATCH_URL, `CREATE DATABASE "${leaked}"`);
    // Deliberately NOT added to createdDbs — that's the point of this test.
    expect(listRollbackTestDatabases(SCRATCH_URL)).toContain(leaked);

    sweepLeakedRollbackTestDatabases(SCRATCH_URL);

    expect(listRollbackTestDatabases(SCRATCH_URL)).not.toContain(leaked);
  });

  // Fix round 3 (Minor 2): restores, against a disposable
  // gc_curriculum_p0b_rbtest* clone (the allowlist permits that name —
  // gc_curriculum_p0b_pre itself does not, by design since fix round 2),
  // the real-DB coverage that round 2 had to remove when the allowlist
  // made gc_curriculum_p0b_pre permanently unusable as a script target.
  it('p0b-db-migrated.sh prints "f" against a real pre-0057 gc_curriculum_p0b_rbtest clone', () => {
    const name = `${ROLLBACK_TEST_DB}_premigr`;
    expect(isP0bRollbackTestDb(name)).toBe(true);
    createdDbs.add(name);
    cloneDatabase(preUrl, name); // clone FROM gc_curriculum_p0b_pre: pre-0057 shape
    const url = withDbName(SCRATCH_URL, name);
    const res = runScript(DB_MIGRATED_SH, [name], { DATABASE_URL: url });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('f');
  });

  it('p0b-db-migrated.sh prints "t" against a real post-0057 gc_curriculum_p0b_rbtest clone', () => {
    const name = `${ROLLBACK_TEST_DB}_postmigr`;
    expect(isP0bRollbackTestDb(name)).toBe(true);
    createdDbs.add(name);
    cloneDatabase(SCRATCH_URL, name); // clone FROM gc_curriculum_p0b_scratch: post-0057 shape
    const url = withDbName(SCRATCH_URL, name);
    const res = runScript(DB_MIGRATED_SH, [name], { DATABASE_URL: url });
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('t');
  });

  it('p0b-apply-db.sh refuses when another session is open on the rbtest target — nothing changed', async () => {
    const name = `${ROLLBACK_TEST_DB}_sessions`;
    expect(isP0bRollbackTestDb(name)).toBe(true);
    createdDbs.add(name);
    cloneDatabase(SCRATCH_URL, name);
    const url = withDbName(SCRATCH_URL, name);
    const before = queryOne(url, 'SELECT count(*) FROM career_target_requirements');

    const holder = new Pool({ connectionString: url, max: 1 });
    const holderQuery = holder.query('SELECT pg_sleep(1.5)');
    try {
      await new Promise((r) => setTimeout(r, 300)); // give the holder time to register as 'active'
      const res = runScript(APPLY_DB_SH, [name, tmp, 'apply'], { DATABASE_URL: url });
      expect(res.status).not.toBe(0);
      expect(res.stderr).toMatch(/refusing: other sessions are connected/);
    } finally {
      await holderQuery;
      await holder.end();
    }
    expect(queryOne(url, 'SELECT count(*) FROM career_target_requirements')).toBe(before);
  });

  // M-2 (hostile review 2026-10-12): a failed pre-apply backup verification
  // used to leave the bad dump sitting in $BACKUP_DIR as the newest
  // pre-apply-*.dump — safe (the rollback-side basename/verify checks would
  // still refuse it), but misleading to a human glancing at the directory.
  // Forces a real apply-mode backup-verification failure via the
  // P0B_APPLY_DB_VERIFY_BACKUP_SH override (a stub that always fails),
  // against a real rbtest clone — the apply never reaches the migration
  // SQL itself, so which shape the clone is in doesn't matter here.
  it('p0b-apply-db.sh renames a backup that fails verification to *.rejected, which can never be mistaken for pre-apply-*.dump', () => {
    const name = `${ROLLBACK_TEST_DB}_backupfail`;
    expect(isP0bRollbackTestDb(name)).toBe(true);
    createdDbs.add(name);
    cloneDatabase(SCRATCH_URL, name);
    const url = withDbName(SCRATCH_URL, name);

    const failingVerifyBackup = join(tmp, 'always-fail-verify-backup.sh');
    writeFileSync(failingVerifyBackup, '#!/usr/bin/env bash\necho "stub: simulated backup verification failure" >&2\nexit 1\n');
    chmodSync(failingVerifyBackup, 0o755);

    const before = readdirSync(tmp).filter(f => f.startsWith('pre-apply-'));

    const res = runScript(APPLY_DB_SH, [name, tmp, 'apply'], {
      DATABASE_URL: url,
      P0B_APPLY_DB_VERIFY_BACKUP_SH: failingVerifyBackup,
    });

    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/backup verification failed; nothing applied\. The bad dump was renamed to .*\.rejected/);

    const after = readdirSync(tmp);
    const rejected = after.filter(f => f.startsWith('pre-apply-') && f.endsWith('.rejected'));
    const stillAPreApplyDump = after.filter(f => f.startsWith('pre-apply-') && f.endsWith('.dump'));
    expect(rejected.length).toBe(1);
    // The renamed file is no longer shaped like pre-apply-*.dump at all —
    // none of the *.dump files left behind are new (only the ones from the
    // tests above this one, none of which this test's clone could have
    // produced since it never got past backup verification).
    expect(stillAPreApplyDump.length).toBe(before.length);

    // The migration never ran — still post-0057, completely untouched.
    expect(queryOne(url, "SELECT to_regclass('public.sub_competency_map') IS NOT NULL")).toBe('t');
  });
});
