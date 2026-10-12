// @vitest-environment node
// Task 8 (competency-catalog P0b plan): the P0b live-apply wrapper
// (scripts/migrations/2026-10-12-p0b-live-apply.sh) is OWNER-RUN against
// launchctl, the real -deploy checkout and the live database — never run
// for real here. Every external dependency is either a PATH stub
// (launchctl, lsof, pnpm) or an environment-variable override pointing at
// a throwaway git repo / stub script — ported from
// tests/scripts/p0a-live-apply-wrapper.test.ts, same methodology, distinct
// P0B_LIVE_APPLY_* env-var prefix so the two suites can never cross-talk.
// Nothing here touches gui/$UID, a real plist, or any database.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const WRAPPER_SH = resolve(ROOT, 'scripts/migrations/2026-10-12-p0b-live-apply.sh');
const REAL_MIGRATION_SQL = resolve(ROOT, 'drizzle/0057_competency_catalog_p0b.sql');

interface Result { status: number; stdout: string; stderr: string }

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeStub(path: string, content: string) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

describe('2026-10-12-p0b-live-apply.sh — static check (always runs)', () => {
  it('bash -n accepts the wrapper, p0b-apply-db.sh and p0b-db-migrated.sh', () => {
    for (const sh of [
      WRAPPER_SH,
      resolve(ROOT, 'scripts/migrations/p0b-apply-db.sh'),
      resolve(ROOT, 'scripts/migrations/p0b-db-migrated.sh'),
    ]) {
      expect(() => execFileSync('bash', ['-n', sh], { encoding: 'utf8' })).not.toThrow();
    }
  });
});

describe('2026-10-12-p0b-live-apply.sh — stubbed failure paths', () => {
  let tmp: string;
  let stubDir: string;
  let deployDir: string;
  let backupDir: string;
  let shaPre: string;        // pre-P0b: no drizzle/0057
  let shaPostMatch: string;  // post-P0b: 0057 byte-identical to this worktree's
  let shaPostMismatch: string; // post-P0b: 0057 tampered
  let dumpPath: string;      // a plausible pre-apply-*.dump path for rollback-arg tests

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'p0b-live-apply-test-'));
    stubDir = join(tmp, 'stubs');
    deployDir = join(tmp, 'deploy');
    backupDir = join(tmp, 'backup');
    mkdirSync(stubDir);
    mkdirSync(deployDir);
    mkdirSync(backupDir);
    dumpPath = join(tmp, 'pre-apply-20261012T000000.dump');
    writeFileSync(dumpPath, 'not a real dump, just needs to exist for wrapper-level arg checks');

    // --- PATH stubs: launchctl, lsof, pnpm --------------------------------
    // Controlled per-call via env vars (STUB_LOG, STUB_PORT_MARKER,
    // STUB_BOOTOUT_FAIL, STUB_BOOTSTRAP_APP_FAIL, STUB_BOOTSTRAP_WATCHDOG_FAIL,
    // STUB_KICKSTART_APP_FAIL, STUB_KICKSTART_WATCHDOG_FAIL,
    // STUB_KICKSTART_APP_TOUCH_MARKER, STUB_PNPM_FAIL), not by editing these
    // files per test. Unlike the P0a stub, `bootstrap` only REGISTERS the
    // job here — the marker (simulating :3000 coming up) is touched by
    // `kickstart`, matching the real 2026-10-11 finding that bootstrap
    // alone does not spawn the job.
    writeStub(join(stubDir, 'launchctl'), `#!/usr/bin/env bash
echo "launchctl $*" >> "\${STUB_LOG:-/dev/null}"
case "$1" in
  bootout)
    case "$*" in
      *curriculum-tool*)
        [ "\${STUB_BOOTOUT_INEFFECTIVE:-0}" = "1" ] || rm -f "\${STUB_PORT_MARKER:-/dev/null}" 2>/dev/null || true
        ;;
    esac
    [ "\${STUB_BOOTOUT_FAIL:-0}" = "1" ] && exit 1
    exit 0 ;;
  bootstrap)
    case "$*" in
      *curriculum-tool.plist*)
        [ "\${STUB_BOOTSTRAP_APP_FAIL:-0}" = "1" ] && exit 1
        exit 0 ;;
      *dev-watchdog.plist*)
        [ "\${STUB_BOOTSTRAP_WATCHDOG_FAIL:-0}" = "1" ] && exit 1
        exit 0 ;;
    esac
    exit 0 ;;
  kickstart)
    case "$*" in
      *curriculum-tool*)
        [ "\${STUB_KICKSTART_APP_FAIL:-0}" = "1" ] && exit 1
        [ "\${STUB_KICKSTART_APP_TOUCH_MARKER:-1}" = "1" ] && touch "\${STUB_PORT_MARKER:-/dev/null}" 2>/dev/null
        exit 0 ;;
      *dev-watchdog*)
        [ "\${STUB_KICKSTART_WATCHDOG_FAIL:-0}" = "1" ] && exit 1
        exit 0 ;;
    esac
    exit 0 ;;
esac
exit 0
`);
    writeStub(join(stubDir, 'lsof'), `#!/usr/bin/env bash
echo "lsof $*" >> "\${STUB_LOG:-/dev/null}"
if [ -f "\${STUB_PORT_MARKER:-/nonexistent-marker-file}" ]; then
  echo "12345 stub"
  exit 0
else
  exit 1
fi
`);
    writeStub(join(stubDir, 'pnpm'), `#!/usr/bin/env bash
echo "pnpm $* (cwd=$(pwd))" >> "\${STUB_LOG:-/dev/null}"
if [ -n "\${STUB_PNPM_SLEEP_MS:-}" ]; then
  echo "pnpm: sleeping"
  sleep "\$(awk "BEGIN { print \${STUB_PNPM_SLEEP_MS} / 1000 }")"
fi
[ "\${STUB_PNPM_FAIL:-0}" = "1" ] && exit 1
exit 0
`);

    // --- throwaway git repo standing in for -deploy -----------------------
    git(deployDir, ['init', '-q']);
    git(deployDir, ['config', 'user.email', 'test@test.com']);
    git(deployDir, ['config', 'user.name', 'test']);
    writeFileSync(join(deployDir, 'package.json'), '{}\n');
    execFileSync('git', ['add', 'package.json'], { cwd: deployDir });
    git(deployDir, ['commit', '-q', '-m', 'pre-P0b']);
    shaPre = git(deployDir, ['rev-parse', 'HEAD']);

    mkdirSync(join(deployDir, 'drizzle'));
    const realMigrationContent = readFileSync(REAL_MIGRATION_SQL, 'utf8');
    writeFileSync(join(deployDir, 'drizzle/0057_competency_catalog_p0b.sql'), realMigrationContent);
    execFileSync('git', ['add', 'drizzle'], { cwd: deployDir });
    git(deployDir, ['commit', '-q', '-m', 'post-P0b-match']);
    shaPostMatch = git(deployDir, ['rev-parse', 'HEAD']);

    writeFileSync(join(deployDir, 'drizzle/0057_competency_catalog_p0b.sql'), realMigrationContent + '\n-- tampered\n');
    execFileSync('git', ['add', 'drizzle'], { cwd: deployDir });
    git(deployDir, ['commit', '-q', '-m', 'post-P0b-mismatch']);
    shaPostMismatch = git(deployDir, ['rev-parse', 'HEAD']);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  /** Checks out shaPre then shaUnderTest, so HEAD@{1} == shaPre (the "previously deployed" sha the wrapper should recover to). */
  function checkoutForTest(shaUnderTest: string) {
    git(deployDir, ['checkout', '-q', shaPre]);
    git(deployDir, ['checkout', '-q', shaUnderTest]);
  }

  function run(args: string[], env: Record<string, string> = {}, timeoutMs = 15000): Result {
    const id = Math.random().toString(36).slice(2);
    const log = join(tmp, `log-${id}.txt`);
    writeFileSync(log, '');
    const fullEnv: NodeJS.ProcessEnv = {
      ...process.env,
      PATH: `${stubDir}:${process.env.PATH}`,
      HOME: tmp, // keep plist default-path construction harmless even if an override is missing
      P0B_LIVE_APPLY_DEPLOY_DIR: deployDir,
      P0B_LIVE_APPLY_BACKUP_DIR: backupDir,
      P0B_LIVE_APPLY_PLIST_APP: join(tmp, 'curriculum-tool.plist'),
      P0B_LIVE_APPLY_PLIST_WATCHDOG: join(tmp, 'dev-watchdog.plist'),
      P0B_LIVE_APPLY_WAIT_SLEEP: '0.05',
      STUB_LOG: log,
      // A fresh, absent-by-default marker per call: the stop-phase wait loop
      // sees "not listening" immediately (nothing was running), and the
      // app kickstart stub then touches this exact path, so the
      // restart-phase wait loop sees "listening" once kickstart actually
      // runs — unless a test overrides STUB_PORT_MARKER or
      // STUB_KICKSTART_APP_TOUCH_MARKER itself.
      STUB_PORT_MARKER: join(tmp, `marker-${id}`),
      ...env,
    };
    try {
      const stdout = execFileSync('bash', [WRAPPER_SH, ...args], { encoding: 'utf8', env: fullEnv, timeout: timeoutMs });
      return { status: 0, stdout, stderr: '' };
    } catch (e) {
      const err = e as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
      return { status: err.status ?? 1, stdout: String(err.stdout ?? ''), stderr: String(err.stderr ?? '') };
    } finally {
      (run as unknown as { lastLog?: string }).lastLog = log;
    }
  }
  function lastLogContents(): string {
    const log = (run as unknown as { lastLog?: string }).lastLog;
    return log && existsSync(log) ? readFileSync(log, 'utf8') : '';
  }

  // --- argument / usage guards -----------------------------------------------
  it('refuses a short SHA (exit 2), calls nothing', () => {
    const res = run(['abc123', 'apply']);
    expect(res.status).toBe(2);
    expect(lastLogContents()).toBe('');
  });

  // --- fix round 2 (Important): the database-name allowlist must be
  // enforced in the wrapper too, for its P0B_LIVE_APPLY_EXPECTED_DB
  // override — not only in the DB scripts it calls. Checked before even
  // the DEPLOY_SHA/mode validation, so nothing is stopped or touched.
  it('refuses a P0B_LIVE_APPLY_EXPECTED_DB override that is not on the allowlist — exit 1, nothing touched, before even the SHA format is checked', () => {
    const res = run(['not-even-a-sha', 'apply'], { P0B_LIVE_APPLY_EXPECTED_DB: 'rag_core' });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/refusing: 'rag_core' is not on the allowed database-name list/);
    expect(lastLogContents()).toBe('');
  });

  it('accepts a P0B_LIVE_APPLY_EXPECTED_DB override matching gc_curriculum_p0b_rbtest* past the allowlist (fails later for the unrelated reason of a short SHA)', () => {
    const res = run(['not-even-a-sha', 'apply'], { P0B_LIVE_APPLY_EXPECTED_DB: 'gc_curriculum_p0b_rbtest_whatever' });
    expect(res.status).toBe(2);
    expect(res.stderr).not.toMatch(/not on the allowed database-name list/);
    expect(res.stderr).toMatch(/must be a full 40-character lowercase hex git SHA/);
  });

  it('refuses a bad mode (exit 2), calls nothing', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'destroy']);
    expect(res.status).toBe(2);
    expect(lastLogContents()).toBe('');
  });

  it('refuses rollback mode with no dump-path argument (exit 2), calls nothing', () => {
    checkoutForTest(shaPre);
    const res = run([shaPre, 'rollback']);
    expect(res.status).toBe(2);
    expect(lastLogContents()).toBe('');
  });

  // --- pre-stop phase: nothing touched, nothing stopped ----------------------
  it('refuses a dirty deploy checkout — PHASE pre-stop, nothing stopped', () => {
    checkoutForTest(shaPostMatch);
    writeFileSync(join(deployDir, 'dirty.txt'), 'x');
    try {
      const res = run([shaPostMatch, 'apply']);
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/not clean/);
      expect(res.stderr).toMatch(/Nothing was stopped and nothing was touched/);
      expect(lastLogContents()).toBe('');
    } finally {
      execFileSync('git', ['clean', '-fdq'], { cwd: deployDir });
    }
  });

  it('refuses a SHA that does not match the deploy checkout HEAD — PHASE pre-stop', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPre, 'apply']); // deploy dir is at shaPostMatch, we claim shaPre
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/is at .*expected/);
    expect(res.stderr).toMatch(/Nothing was stopped and nothing was touched/);
    expect(lastLogContents()).toBe('');
  });

  // --- SHA must match the mode, and 0057 must match byte-for-byte -----------
  it('apply mode refuses a pre-P0b SHA (no drizzle/0057) — nothing stopped', () => {
    checkoutForTest(shaPre);
    const res = run([shaPre, 'apply']);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/has no drizzle\/0057_competency_catalog_p0b\.sql/);
    expect(lastLogContents()).toBe('');
  });

  it('rollback mode refuses a post-P0b SHA that contains 0057 — nothing stopped', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'rollback', dumpPath]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/DOES have drizzle\/0057_competency_catalog_p0b\.sql/);
    expect(lastLogContents()).toBe('');
  });

  it('apply mode refuses when the SHA\'s 0057 differs byte-for-byte from the local one — nothing stopped', () => {
    checkoutForTest(shaPostMismatch);
    const res = run([shaPostMismatch, 'apply']);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/differs byte-for-byte/);
    expect(lastLogContents()).toBe('');
  });

  it('rollback mode refuses a dump path that does not exist — nothing stopped', () => {
    checkoutForTest(shaPre);
    const res = run([shaPre, 'rollback', join(tmp, 'pre-apply-does-not-exist.dump')]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/does not exist/);
    expect(lastLogContents()).toBe('');
  });

  // --- stopped phase: read-env failure --------------------------------------
  it('read-env failure — PHASE stopped: app+watchdog ARE stopped, DB untouched, previous SHA printed', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, { fail: true }),
    });
    expect(res.status).not.toBe(0);
    expect(res.stderr).toMatch(/The app and watchdog are STOPPED/);
    expect(res.stderr).toMatch(/database is UNTOUCHED/);
    expect(res.stderr).toContain(shaPre); // the previously-deployed SHA, from git reflog
    expect(lastLogContents()).toMatch(/launchctl bootout.*dev-watchdog/);
    expect(lastLogContents()).toMatch(/launchctl bootout.*curriculum-tool/);
  });

  // --- stopped phase: :3000 never closes (bootout had no effect) -------------
  it(':3000 never closes — PHASE stopped: refuses, DB not touched, no DB script called', () => {
    checkoutForTest(shaPostMatch);
    const marker = join(tmp, 'port-marker-stuck');
    writeFileSync(marker, ''); // "old app" already listening before this run
    try {
      const res = run([shaPostMatch, 'apply'], { STUB_PORT_MARKER: marker, STUB_BOOTOUT_INEFFECTIVE: '1' });
      expect(res.status).toBe(1);
      expect(res.stderr).toMatch(/still listening on :3000/);
      expect(res.stderr).toMatch(/database was NOT touched/);
      expect(lastLogContents()).not.toMatch(/stub-apply-db-called/);
      expect(lastLogContents()).toMatch(/launchctl bootout.*curriculum-tool/);
    } finally {
      rmSync(marker, { force: true });
    }
  });

  // --- db-done phase: committed, but verify failed afterward ----------------
  it('DB step commits but verify fails (exit 4) — never says SAFE, says investigate/rollback instead', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 4 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
    });
    expect(res.status).toBe(4);
    expect(res.stderr).toMatch(/committed, but verification failed afterward/);
    expect(res.stderr).toMatch(/migration committed but verification failed — do not bootstrap; run rollback or inspect/);
    expect(res.stderr).not.toMatch(/SAFE to bootstrap/);
  });

  // --- db-done phase: a generic (non-committing) failure, state still
  // happens to match the build for an unrelated reason — still SAFE.
  it('a generic pre-commit guard failure (exit 1) with a state that already matches — still SAFE (distinct from exit 4)', () => {
    checkoutForTest(shaPre);
    const res = run([shaPre, 'rollback', dumpPath], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 1 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 'f' }), // f matches rollback's expectation
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Queried database state: migrated=f/);
    expect(res.stderr).toMatch(/SAFE to bootstrap the current build/);
    expect(res.stderr).not.toMatch(/restore the previous build first/);
    expect(res.stderr).toMatch(/launchctl kickstart/);
  });

  // --- db-done phase: rollback's swap failed partway, auto-fallback worked
  // (p0b-apply-db.sh exit 5) ------------------------------------------------
  // Fix round 2 (Important, reviewer finding): round 1's message here said
  // "Do NOT bootstrap a pre-P0b build against this still-migrated
  // database:" and then printed exactly the bootstrap/kickstart commands
  // for $DEPLOY_SHA — which IS the pre-P0b build in rollback mode. Following
  // those lines did precisely what the sentence in front of them forbade.
  // The fix reuses report_db_state_and_recovery, which queries the real
  // state and recommends checking out and building $PREVIOUS_SHA (the
  // build that actually matches a still-migrated database) BEFORE any
  // bootstrap/kickstart line. This test sets up a deploy history where
  // shaPostMatch ("the P0b sha") was checked out before shaPre ("the
  // rollback target"), so PREVIOUS_SHA == shaPostMatch is the one the
  // message must name.
  it('rollback swap fails partway but the automatic fallback rename-back succeeded (exit 5) — recommends checking out and building the P0b SHA before any bootstrap command, never bootstraps the pre-P0b build directly', () => {
    git(deployDir, ['checkout', '-q', shaPostMatch]); // "the P0b sha" — what's actually live right now
    git(deployDir, ['checkout', '-q', shaPre]); // this invocation's rollback target
    const res = run([shaPre, 'rollback', dumpPath], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 5 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
    });
    expect(res.status).toBe(5);
    expect(res.stderr).toMatch(/automatic fallback already renamed the live database back/);
    expect(res.stderr).toMatch(/see the output above from p0b-apply-db\.sh/);
    expect(res.stderr).not.toMatch(/SAFE to bootstrap/);
    expect(res.stderr).not.toMatch(/CRITICAL/);
    expect(res.stderr).not.toMatch(/Do NOT bootstrap/); // round 1's backwards warning is gone

    // Names the right SHA: the build that actually matches a still-migrated database.
    expect(res.stderr).toContain(shaPostMatch);

    // Every bootstrap/kickstart line must be preceded by the checkout+build
    // step for that same SHA — never a bare bootstrap command on its own.
    const checkoutLineIdx = res.stderr.indexOf(`checkout ${shaPostMatch}`);
    expect(checkoutLineIdx).toBeGreaterThan(-1);
    const firstBootstrapIdx = res.stderr.indexOf('launchctl bootstrap');
    expect(firstBootstrapIdx).toBeGreaterThan(checkoutLineIdx);
  });

  // --- db-done phase: rollback's swap failed catastrophically, the
  // automatic fallback ALSO failed (fix round 1: p0b-apply-db.sh exit 6) ---
  it('rollback swap fails catastrophically and the fallback also fails (exit 6) — CRITICAL, points at the exact manual fix printed by p0b-apply-db.sh', () => {
    checkoutForTest(shaPre);
    const res = run([shaPre, 'rollback', dumpPath], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 6 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
    });
    expect(res.status).toBe(6);
    expect(res.stderr).toMatch(/CRITICAL/);
    expect(res.stderr).toMatch(/does not currently exist on this server under its own name/);
    expect(res.stderr).toMatch(/Scroll up to p0b-apply-db\.sh's own output/);
    expect(res.stderr).not.toMatch(/SAFE to bootstrap/);
  });

  // --- db-done phase: DB step fails, DB state does NOT match the new build ---
  it('DB step fails and the DB does NOT match the new build — refuses to recommend bootstrap, gives the restore-previous-build recovery', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 1 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 'f' }),
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Queried database state: migrated=f/);
    expect(res.stderr).toMatch(/does NOT match the database\. Do not bootstrap that build/);
    expect(res.stderr).toMatch(/git -C .* checkout/);
    expect(res.stderr).toContain(shaPre);
  });

  // --- db-done phase: DB state itself can't be determined --------------------
  it('DB step fails and the DB state cannot be queried — "DB state UNKNOWN", never "safe to bootstrap"', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 1 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { fail: true }),
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/DB state UNKNOWN — do not bootstrap; inspect manually/);
    expect(res.stderr).not.toMatch(/SAFE to bootstrap the current build/);
    expect(res.stderr).not.toMatch(/does NOT match the database\. Do not bootstrap that build/);
  });

  // --- happy path: full success, apply mode ----------------------------------
  it('happy path (apply): DB step succeeds, app and watchdog restart via bootstrap+kickstart, smoke-test message, no failure text', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Smoke test/);
    expect(res.stdout).toMatch(/update docs\/STATE\.md: P0b applied to production/);
    expect(res.stderr).toBe('');
    const log = lastLogContents();
    expect(log).toMatch(/pnpm build/);
    expect(log).toMatch(/launchctl bootstrap.*curriculum-tool\.plist/);
    expect(log).toMatch(/launchctl bootstrap.*dev-watchdog\.plist/);
    expect(log).toMatch(/launchctl kickstart.*curriculum-tool/);
    expect(log).toMatch(/launchctl kickstart.*dev-watchdog/);
  });

  // --- happy path: full success, rollback mode (restore) ---------------------
  it('happy path (rollback): DB step succeeds via restore, app and watchdog restart, smoke-test message', () => {
    checkoutForTest(shaPre);
    const res = run([shaPre, 'rollback', dumpPath], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 'f' }),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Smoke test/);
    const log = lastLogContents();
    expect(log).toMatch(/stub-apply-db-called mode=rollback/);
  });

  // --- M-3 (hostile review 2026-10-12): rollback mode's smoke test and
  // STATE.md instruction must describe ROLLBACK, not reuse apply's text —
  // the DB is restored to pre-P0b, not migrated, so "a merged competency:
  // confirm the merged descriptors" and "P0b applied to production" are
  // both false statements about what just happened.
  it("rollback mode's smoke test describes PRE-P0b behavior and tells the owner to record a rollback, never apply's text", () => {
    checkoutForTest(shaPre);
    const res = run([shaPre, 'rollback', dumpPath], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 'f' }),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/DB rollback applied/);
    expect(res.stdout).toMatch(/pre-P0b build/);
    expect(res.stdout).toMatch(/update docs\/STATE\.md: P0b rolled back/);
    // Never the apply-mode text.
    expect(res.stdout).not.toMatch(/P0b applied to production/);
    expect(res.stdout).not.toMatch(/confirm the merged descriptors/);
  });

  // --- NEW (task-8 brief): kickstart is called after bootstrap, for both jobs
  it('kickstart runs AFTER bootstrap, for both the app job and the watchdog job', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
    });
    expect(res.status).toBe(0);
    const lines = lastLogContents().split('\n').filter(Boolean);
    const idxBootstrapApp = lines.findIndex((l) => l.startsWith('launchctl bootstrap') && l.includes('curriculum-tool.plist'));
    const idxKickstartApp = lines.findIndex((l) => l.startsWith('launchctl kickstart') && l.includes('curriculum-tool'));
    const idxBootstrapWatchdog = lines.findIndex((l) => l.startsWith('launchctl bootstrap') && l.includes('dev-watchdog.plist'));
    const idxKickstartWatchdog = lines.findIndex((l) => l.startsWith('launchctl kickstart') && l.includes('dev-watchdog'));
    expect(idxBootstrapApp).toBeGreaterThanOrEqual(0);
    expect(idxKickstartApp).toBeGreaterThan(idxBootstrapApp);
    expect(idxBootstrapWatchdog).toBeGreaterThan(idxKickstartApp);
    expect(idxKickstartWatchdog).toBeGreaterThan(idxBootstrapWatchdog);
  });

  // --- restarting-app phase: app never comes up after a successful DB step ---
  it('app never comes up on :3000 after a successful DB step (kickstart did not spawn it) — PHASE restarting-app, watchdog NOT bootstrapped', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
      STUB_KICKSTART_APP_TOUCH_MARKER: '0',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/did not come up on :3000 within the timeout \(bootstrap \+ kickstart were both run\)/);
    expect(res.stderr).toMatch(/watchdog has NOT been bootstrapped/);
    const log = lastLogContents();
    expect(log).toMatch(/launchctl bootstrap.*curriculum-tool\.plist/);
    expect(log).toMatch(/launchctl kickstart.*curriculum-tool/);
    expect(log).not.toMatch(/launchctl bootstrap.*dev-watchdog\.plist/);
  });

  // --- restarting-watchdog phase: app comes up, watchdog bootstrap fails -----
  it('watchdog bootstrap fails after a successful app restart — PHASE restarting-watchdog, retry-watchdog-only message', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
      STUB_BOOTSTRAP_WATCHDOG_FAIL: '1',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/app IS up on :3000, but bootstrapping \(or kickstarting\) the watchdog failed/);
    expect(res.stderr).toMatch(/launchctl bootstrap gui.*\$PLIST_WATCHDOG|launchctl bootstrap gui.*dev-watchdog/);
    expect(res.stderr).not.toMatch(/does NOT match the database/);
    const log = lastLogContents();
    expect(log).toMatch(/launchctl bootstrap.*curriculum-tool\.plist/);
    expect(log).not.toMatch(/launchctl kickstart.*dev-watchdog/);
  });

  // --- Ctrl-C mid-run ---------------------------------------------------------
  function spawnDetachedWrapper(args: string[], env: Record<string, string>) {
    return spawn('bash', [WRAPPER_SH, ...args], {
      detached: true,
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        HOME: tmp,
        P0B_LIVE_APPLY_DEPLOY_DIR: deployDir,
        P0B_LIVE_APPLY_BACKUP_DIR: backupDir,
        P0B_LIVE_APPLY_PLIST_APP: join(tmp, 'curriculum-tool.plist'),
        P0B_LIVE_APPLY_PLIST_WATCHDOG: join(tmp, 'dev-watchdog.plist'),
        P0B_LIVE_APPLY_WAIT_SLEEP: '0.05',
        ...env,
      },
    });
  }

  async function runAndInterruptOnStdout(
    child: ReturnType<typeof spawn>,
    shouldInterrupt: (stdoutSoFar: string) => boolean,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d) => { stdout += String(d); });
    child.stderr!.on('data', (d) => { stderr += String(d); });
    const exitCode = await new Promise<number>((res) => {
      let sent = false;
      const timer = setInterval(() => {
        if (!sent && shouldInterrupt(stdout)) {
          sent = true;
          clearInterval(timer);
          process.kill(-child.pid!, 'SIGINT');
        }
      }, 20);
      child.on('exit', (code) => { clearInterval(timer); res(code ?? -1); });
    });
    return { exitCode, stdout, stderr };
  }

  it('Ctrl-C (SIGINT to the process group) during the build — exits 130, PHASE pre-stop, untouched message', async () => {
    checkoutForTest(shaPostMatch);
    const log = join(tmp, 'log-sigint-build.txt');
    writeFileSync(log, '');
    const child = spawnDetachedWrapper([shaPostMatch, 'apply'], {
      STUB_LOG: log,
      STUB_PNPM_SLEEP_MS: '3000',
    });
    const { exitCode, stderr } = await runAndInterruptOnStdout(child, (out) => out.includes('pnpm: sleeping'));
    expect(exitCode).toBe(130);
    expect(stderr).toMatch(/Nothing was stopped and nothing was touched/);
  }, 20000);

  it('Ctrl-C (SIGINT to the process group) while the DB step is genuinely running — PHASE db-attempt, queries real state', async () => {
    checkoutForTest(shaPostMatch);
    const log = join(tmp, 'log-sigint-db.txt');
    writeFileSync(log, '');
    const child = spawnDetachedWrapper([shaPostMatch, 'apply'], {
      P0B_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0B_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0, sleepMs: 3000 }),
      P0B_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
      STUB_LOG: log,
    });
    const { exitCode, stderr } = await runAndInterruptOnStdout(child, (out) => out.includes('stub-apply-db: now sleeping'));
    expect(exitCode).toBe(130);
    expect(stderr).toMatch(/was interrupted or did not return — querying its actual state rather than assuming UNTOUCHED/);
    expect(stderr).toMatch(/Queried database state: migrated=t/);
    expect(stderr).toMatch(/SAFE to bootstrap the current build/);
    expect(stderr).not.toMatch(/database is UNTOUCHED/);
  }, 20000);
});

function writeReadEnvStub(tmp: string, opts: { fail?: boolean; sleepMs?: number }): string {
  const p = join(tmp, `read-env-${Math.random().toString(36).slice(2)}.mjs`);
  const lines: string[] = [];
  if (opts.sleepMs) lines.push(`await new Promise(r => setTimeout(r, ${opts.sleepMs}));`);
  if (opts.fail) {
    lines.push("console.error('stub read-env: forced failure'); process.exit(1);");
  } else {
    lines.push("console.log('postgres://fake:fake@127.0.0.1:1/fake_stub_db');");
  }
  writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

function writeApplyDbStub(tmp: string, opts: { exitCode: number; sleepMs?: number }): string {
  const p = join(tmp, `apply-db-${Math.random().toString(36).slice(2)}.sh`);
  const lines = ['#!/usr/bin/env bash', 'echo "stub-apply-db-called mode=$3" >> "${STUB_LOG:-/dev/null}"'];
  if (opts.sleepMs) {
    lines.push('echo "stub-apply-db: now sleeping"');
    lines.push(`sleep "$(awk 'BEGIN { print ${opts.sleepMs} / 1000 }')"`);
  }
  lines.push(`exit ${opts.exitCode}`);
  writeStub(p, lines.join('\n') + '\n');
  return p;
}

function writeDbMigratedStub(tmp: string, opts: { output?: string; fail?: boolean }): string {
  const p = join(tmp, `db-migrated-${Math.random().toString(36).slice(2)}.sh`);
  const body = opts.fail ? 'exit 1\n' : `echo "${opts.output ?? 'f'}"\n`;
  writeStub(p, `#!/usr/bin/env bash\n${body}`);
  return p;
}
