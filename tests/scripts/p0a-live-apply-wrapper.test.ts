// @vitest-environment node
// I-2 / M-b (adversarial review round 2): the live-apply wrapper
// (scripts/migrations/2026-10-11-p0a-live-apply.sh) is OWNER-RUN against
// launchctl, the real -deploy checkout and the live database — never run
// for real here. Every external dependency is either a PATH stub
// (launchctl, lsof, pnpm) or an environment-variable override pointing at
// a throwaway git repo / stub script, exactly as the round-2 reviewer did
// by hand. No override changes what is checked, only where it looks — the
// production defaults are untouched (see the wrapper's own header
// comment). Nothing here touches gui/$UID, a real plist, or any database.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, chmodSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const WRAPPER_SH = resolve(ROOT, 'scripts/migrations/2026-10-11-p0a-live-apply.sh');
const REAL_MIGRATION_SQL = resolve(ROOT, 'drizzle/0056_competency_catalog_p0a.sql');

interface Result { status: number; stdout: string; stderr: string }

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function writeStub(path: string, content: string) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

describe('2026-10-11-p0a-live-apply.sh — static check (always runs)', () => {
  it('bash -n accepts the wrapper and p0a-db-migrated.sh', () => {
    for (const sh of [WRAPPER_SH, resolve(ROOT, 'scripts/migrations/p0a-db-migrated.sh')]) {
      expect(() => execFileSync('bash', ['-n', sh], { encoding: 'utf8' })).not.toThrow();
    }
  });
});

describe('2026-10-11-p0a-live-apply.sh — stubbed failure paths (I-2, M-b)', () => {
  let tmp: string;
  let stubDir: string;
  let deployDir: string;
  let backupDir: string;
  let shaPre: string;        // pre-P0a: no drizzle/0056
  let shaPostMatch: string;  // post-P0a: 0056 byte-identical to this worktree's
  let shaPostMismatch: string; // post-P0a: 0056 tampered

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'p0a-live-apply-test-'));
    stubDir = join(tmp, 'stubs');
    deployDir = join(tmp, 'deploy');
    backupDir = join(tmp, 'backup');
    mkdirSync(stubDir);
    mkdirSync(deployDir);
    mkdirSync(backupDir);

    // --- PATH stubs: launchctl, lsof, pnpm --------------------------------
    // Controlled per-call via env vars (STUB_LOG, STUB_PORT_MARKER,
    // STUB_BOOTOUT_FAIL, STUB_BOOTSTRAP_APP_FAIL, STUB_BOOTSTRAP_WATCHDOG_FAIL,
    // STUB_PNPM_FAIL), not by editing these files per test.
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
        [ "\${STUB_BOOTSTRAP_APP_TOUCH_MARKER:-1}" = "1" ] && touch "\${STUB_PORT_MARKER:-/dev/null}" 2>/dev/null
        exit 0 ;;
      *dev-watchdog.plist*)
        [ "\${STUB_BOOTSTRAP_WATCHDOG_FAIL:-0}" = "1" ] && exit 1
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
    git(deployDir, ['commit', '-q', '-m', 'pre-P0a']);
    shaPre = git(deployDir, ['rev-parse', 'HEAD']);

    mkdirSync(join(deployDir, 'drizzle'));
    const realMigrationContent = readFileSync(REAL_MIGRATION_SQL, 'utf8');
    writeFileSync(join(deployDir, 'drizzle/0056_competency_catalog_p0a.sql'), realMigrationContent);
    execFileSync('git', ['add', 'drizzle'], { cwd: deployDir });
    git(deployDir, ['commit', '-q', '-m', 'post-P0a-match']);
    shaPostMatch = git(deployDir, ['rev-parse', 'HEAD']);

    writeFileSync(join(deployDir, 'drizzle/0056_competency_catalog_p0a.sql'), realMigrationContent + '\n-- tampered\n');
    execFileSync('git', ['add', 'drizzle'], { cwd: deployDir });
    git(deployDir, ['commit', '-q', '-m', 'post-P0a-mismatch']);
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
      P0A_LIVE_APPLY_DEPLOY_DIR: deployDir,
      P0A_LIVE_APPLY_BACKUP_DIR: backupDir,
      P0A_LIVE_APPLY_PLIST_APP: join(tmp, 'curriculum-tool.plist'),
      P0A_LIVE_APPLY_PLIST_WATCHDOG: join(tmp, 'dev-watchdog.plist'),
      P0A_LIVE_APPLY_WAIT_SLEEP: '0.05',
      STUB_LOG: log,
      // A fresh, absent-by-default marker per call: the stop-phase wait loop
      // sees "not listening" immediately (nothing was running), and the
      // app-plist bootstrap stub then touches this exact path, so the
      // restart-phase wait loop sees "listening" once bootstrap actually
      // runs — unless a test overrides STUB_PORT_MARKER or
      // STUB_BOOTSTRAP_APP_TOUCH_MARKER itself.
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

  it('refuses a bad mode (exit 2), calls nothing', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'destroy']);
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

  // --- M-b: SHA must match the mode, and 0056 must match byte-for-byte -------
  it('M-b: apply mode refuses a pre-P0a SHA (no drizzle/0056) — nothing stopped', () => {
    checkoutForTest(shaPre);
    const res = run([shaPre, 'apply']);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/has no drizzle\/0056_competency_catalog_p0a\.sql/);
    expect(lastLogContents()).toBe('');
  });

  it('M-b: rollback mode refuses a post-P0a SHA (has drizzle/0056) — nothing stopped', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'rollback']);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/DOES have drizzle\/0056_competency_catalog_p0a\.sql/);
    expect(lastLogContents()).toBe('');
  });

  it('M-b: apply mode refuses when the SHA\'s 0056 differs byte-for-byte from the local one — nothing stopped', () => {
    checkoutForTest(shaPostMismatch);
    const res = run([shaPostMismatch, 'apply']);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/differs byte-for-byte/);
    expect(lastLogContents()).toBe('');
  });

  // --- stopped phase: read-env failure --------------------------------------
  it('read-env failure — PHASE stopped: app+watchdog ARE stopped, DB untouched, previous SHA printed', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, { fail: true }),
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
      // STUB_BOOTOUT_INEFFECTIVE: bootout runs (and "succeeds") but does not
      // actually remove the marker — simulating a bootout that returns 0
      // without the port actually closing (e.g. something relaunches it).
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

  // --- db-done phase: committed, but verify failed afterward (M-i) ----------
  // p0a-apply-db.sh's distinct exit code 4 means "the migration DID commit,
  // but verify found a problem afterward" — this must NEVER say SAFE, even
  // though the schema now matches what the build expects (that's exactly
  // the case round 3 found contradictory: "do not deploy" right above
  // "SAFE to bootstrap").
  it('M-i: DB step commits but verify fails (exit 4) — never says SAFE, says investigate/rollback instead', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0A_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 4 }),
      P0A_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
    });
    expect(res.status).toBe(4);
    expect(res.stderr).toMatch(/committed, but verification failed afterward/);
    expect(res.stderr).toMatch(/migration committed but verification failed — do not bootstrap; run rollback or inspect/);
    expect(res.stderr).not.toMatch(/SAFE to bootstrap/);
  });

  // --- db-done phase: a generic (non-committing) failure, state still
  // happens to match the build for an unrelated reason (e.g. the DB was
  // already in that shape from an earlier successful run) — still SAFE.
  // Uses rollback mode so it can't be confused with the exit-4 case above:
  // a plain guard failure (wrong DB, other sessions, bad backup) never
  // reaches 0056/the rollback SQL, so DB_RC is a generic 1, not 4.
  it('a generic pre-commit guard failure (exit 1) with a state that already matches — still SAFE (distinct from M-i)', () => {
    checkoutForTest(shaPre);
    const res = run([shaPre, 'rollback'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0A_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 1 }),
      P0A_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 'f' }), // f matches rollback's expectation
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Queried database state: migrated=f/);
    expect(res.stderr).toMatch(/SAFE to bootstrap the current build/);
    expect(res.stderr).not.toMatch(/restore the previous build first/);
  });

  // --- db-done phase: DB step fails, DB state does NOT match the new build ---
  // This is the critical round-1 I-1 recreation check: the wrapper must NOT
  // just say "restart" — it must say "do not bootstrap" and give the
  // checkout-the-previous-build recovery instead.
  it('DB step fails and the DB does NOT match the new build — refuses to recommend bootstrap, gives the restore-previous-build recovery', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0A_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 1 }),
      P0A_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 'f' }),
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/Queried database state: migrated=f/);
    expect(res.stderr).toMatch(/does NOT match the database\. Do not bootstrap that build/);
    expect(res.stderr).toMatch(/git -C .* checkout/);
    expect(res.stderr).toContain(shaPre);
  });

  // --- db-done phase: DB state itself can't be determined (M-h) --------------
  // Covers both "p0a-db-migrated.sh couldn't reach the database" and "it
  // refused because DATABASE_URL didn't point at the expected database" —
  // the wrapper treats them identically: state UNKNOWN, never a guess.
  it('M-h: DB step fails and the DB state cannot be queried — "DB state UNKNOWN", never "safe to bootstrap"', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0A_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 1 }),
      P0A_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { fail: true }),
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/DB state UNKNOWN — do not bootstrap; inspect manually/);
    expect(res.stderr).not.toMatch(/SAFE to bootstrap the current build/);
    expect(res.stderr).not.toMatch(/does NOT match the database\. Do not bootstrap that build/);
  });

  // --- happy path: full success --------------------------------------------
  it('happy path: DB step succeeds, app and watchdog restart, smoke-test message, no failure text', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0A_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0 }),
      P0A_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/Smoke test/);
    expect(res.stdout).toMatch(/update docs\/STATE\.md: P0a applied to production/);
    expect(res.stderr).toBe('');
    const log = lastLogContents();
    expect(log).toMatch(/pnpm build/);
    expect(log).toMatch(/launchctl bootstrap.*curriculum-tool\.plist/);
    expect(log).toMatch(/launchctl bootstrap.*dev-watchdog\.plist/);
  });

  // --- restarting-app phase: app never comes up after a successful DB step ---
  it('app never comes up on :3000 after a successful DB step — PHASE restarting-app, watchdog NOT bootstrapped', () => {
    checkoutForTest(shaPostMatch);
    // launchctl bootstrap for the app plist succeeds (exit 0, a realistic
    // "the command ran" case), but is told not to touch the port marker, so
    // the wait loop genuinely times out (30 fast iterations) rather than the
    // simpler "the bootstrap command itself failed" case.
    const res = run([shaPostMatch, 'apply'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0A_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0 }),
      P0A_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
      STUB_BOOTSTRAP_APP_TOUCH_MARKER: '0',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/did not come up on :3000 within the timeout/);
    expect(res.stderr).toMatch(/watchdog has NOT been bootstrapped/);
    const log = lastLogContents();
    expect(log).toMatch(/launchctl bootstrap.*curriculum-tool\.plist/);
    expect(log).not.toMatch(/launchctl bootstrap.*dev-watchdog\.plist/);
  });

  // --- restarting-watchdog phase: app comes up, watchdog bootstrap fails -----
  it('watchdog bootstrap fails after a successful app restart — PHASE restarting-watchdog, retry-watchdog-only message', () => {
    checkoutForTest(shaPostMatch);
    const res = run([shaPostMatch, 'apply'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0A_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0 }),
      P0A_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
      STUB_BOOTSTRAP_WATCHDOG_FAIL: '1',
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/app IS up on :3000, but bootstrapping the watchdog failed/);
    expect(res.stderr).toMatch(/launchctl bootstrap .*dev-watchdog/);
    expect(res.stderr).not.toMatch(/does NOT match the database/);
    const log = lastLogContents();
    expect(log).toMatch(/launchctl bootstrap.*curriculum-tool\.plist/);
  });

  // --- Ctrl-C mid-run ---------------------------------------------------------
  // IMPORTANT, corrected in round 3 (M-g): a signal sent with
  // `child.kill()` only reaches the direct child (bash) — bash does NOT
  // act on a pending trap-able signal while a foreground child (a command
  // substitution's process, or a plain external command) is still
  // running; it defers handling until that child returns on its own. A
  // real terminal Ctrl-C does not have this problem, because the terminal
  // driver sends SIGINT to the whole foreground PROCESS GROUP at once,
  // hitting bash's child directly too. Round 2's version of this test
  // asserted the opposite (that `child.kill()` interrupts bash immediately
  // even mid-command-substitution) based on a run that was never actually
  // timed — instrumenting it with timestamps during this round's work
  // showed the signal was handled only after the full artificial delay had
  // already elapsed. `spawnDetachedWrapper` below fixes this by giving the
  // wrapper its own process group and signaling that group (`-pid`),
  // matching the round-3 reviewer's own method and a real terminal Ctrl-C.
  function spawnDetachedWrapper(args: string[], env: Record<string, string>) {
    return spawn('bash', [WRAPPER_SH, ...args], {
      detached: true,
      env: {
        ...process.env,
        PATH: `${stubDir}:${process.env.PATH}`,
        HOME: tmp,
        P0A_LIVE_APPLY_DEPLOY_DIR: deployDir,
        P0A_LIVE_APPLY_BACKUP_DIR: backupDir,
        P0A_LIVE_APPLY_PLIST_APP: join(tmp, 'curriculum-tool.plist'),
        P0A_LIVE_APPLY_PLIST_WATCHDOG: join(tmp, 'dev-watchdog.plist'),
        P0A_LIVE_APPLY_WAIT_SLEEP: '0.05',
        ...env,
      },
    });
  }

  /** Runs `child` to completion, calling `onStdoutChunk` after every stdout write and sending SIGINT to the whole process group the first time it returns true. */
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

  it('Ctrl-C (SIGINT to the process group) while the DB step is genuinely running — PHASE db-attempt, queries real state (M-g)', async () => {
    checkoutForTest(shaPostMatch);
    const log = join(tmp, 'log-sigint-db.txt');
    writeFileSync(log, '');
    const child = spawnDetachedWrapper([shaPostMatch, 'apply'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0A_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0, sleepMs: 3000 }),
      P0A_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 't' }),
      STUB_LOG: log,
    });
    const { exitCode, stderr } = await runAndInterruptOnStdout(child, (out) => out.includes('stub-apply-db: now sleeping'));
    expect(exitCode).toBe(130);
    expect(stderr).toMatch(/was interrupted or did not return — querying its actual state rather than assuming UNTOUCHED/);
    expect(stderr).toMatch(/Queried database state: migrated=t/);
    expect(stderr).toMatch(/SAFE to bootstrap the current build/);
    expect(stderr).not.toMatch(/database is UNTOUCHED/);
  }, 20000);

  it('Ctrl-C (SIGINT to the process group) while the DB step is running and the state does NOT match — refuses to say SAFE (M-g)', async () => {
    checkoutForTest(shaPostMatch);
    const log = join(tmp, 'log-sigint-db-mismatch.txt');
    writeFileSync(log, '');
    const child = spawnDetachedWrapper([shaPostMatch, 'apply'], {
      P0A_LIVE_APPLY_READ_ENV_MJS: writeReadEnvStub(tmp, {}),
      P0A_LIVE_APPLY_APPLY_DB_SH: writeApplyDbStub(tmp, { exitCode: 0, sleepMs: 3000 }),
      P0A_LIVE_APPLY_DB_MIGRATED_SH: writeDbMigratedStub(tmp, { output: 'f' }),
      STUB_LOG: log,
    });
    const { exitCode, stderr } = await runAndInterruptOnStdout(child, (out) => out.includes('stub-apply-db: now sleeping'));
    expect(exitCode).toBe(130);
    expect(stderr).toMatch(/Queried database state: migrated=f/);
    expect(stderr).toMatch(/does NOT match the database\. Do not bootstrap that build/);
    expect(stderr).not.toMatch(/SAFE to bootstrap/);
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
