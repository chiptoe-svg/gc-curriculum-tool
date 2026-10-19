#!/usr/bin/env node
/**
 * Shared OpenAI credit check + owner alert (owner decision 2026-10-19).
 *
 * All OpenAI traffic goes through Clemson RCD's gateway, which has no balance
 * endpoint, so the check is one tiny real request (1 token). Runs at 7am, noon
 * and 4pm local (Eastern) via launchd com.gc.ai-credit-check, and also whenever
 * the app touches ~/.local/state/gc-curriculum-tool/ai-credits.trigger (the app
 * does that the moment a real request hits quota_denied).
 *
 * Modes
 *   default       probe, update the status file (source "probe"), then alert.
 *   --alert-only  no OpenAI call: read the status file and alert from it.
 *   (auto)        one plist cannot pass different arguments to a WatchPaths run,
 *                 so the script decides: if the trigger file is NEWER than the
 *                 last-run marker (ai-credits.last-run, touched at the end of
 *                 every run), this is a trigger run and behaves as --alert-only.
 *   --dry-run     prints what it would do; creates no directories, writes no
 *                 files (status, log, last-run), opens/closes no issues. It
 *                 STILL sends the one-token probe and runs `gh issue list`
 *                 (both read-only). `--alert-only --dry-run` makes no OpenAI
 *                 call (it only reads the status file and runs `gh issue list`).
 *
 * Blind monitor: after 3 consecutive "unknown" probes (status file field
 * unknownStreak) an issue "AI credit monitor can't reach a verdict" is opened
 * under the same label and closed at the next ok/exhausted result.
 *
 * Alert: a GitHub issue labelled `ai-credits` (same repo/token/gh as the
 * cost-cap and backup monitors). Exhausted + no open issue -> open one.
 * Already open -> nothing (no comment spam). Credits back -> comment + close.
 * A probe that cannot tell (network, 5xx, other 4xx) is logged and ignored; it
 * never overwrites a known "exhausted" status.
 *
 * Env comes from the PRODUCTION checkout via @next/env (never hand-parsed).
 * Never prints the API key.
 *
 * INSTALL (controller, at deploy, with the owner's yes):
 *   cp scripts/ai/com.gc.ai-credit-check.plist ~/Library/LaunchAgents/
 *   launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.gc.ai-credit-check.plist
 *   (WatchPaths needs the trigger file to exist: touch ~/.local/state/gc-curriculum-tool/ai-credits.trigger)
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { BLIND_THRESHOLD, BLIND_TITLE, DEFAULT_PROBE_MODEL, ISSUE_TITLE, blindBody, decideBlind, LABEL, classifyProbe, decideAlert, isTriggerRun, issueBody, nextStatus } from './credit-check-lib.mjs';

const DEPLOY = process.env.APP_DIR ?? path.join(homedir(), 'projects/curriculum_developer-deploy');
const require = createRequire(path.join(DEPLOY, 'package.json'));
const store = path.join(DEPLOY, 'node_modules/.pnpm');
const nextEnvDir = readdirSync(store).find(d => d.startsWith('@next+env@'));
const { loadEnvConfig } = require(path.join(store, nextEnvDir, 'node_modules/@next/env'));
loadEnvConfig(DEPLOY, false, { info: () => {}, error: console.error });

const DRY = process.argv.includes('--dry-run');
const STATE = path.join(homedir(), '.local/state/gc-curriculum-tool');
const STATUS_FILE = process.env.AI_CREDITS_STATUS_FILE || path.join(STATE, 'ai-credits.json');
const TRIGGER_FILE = process.env.AI_CREDITS_TRIGGER_FILE || path.join(STATE, 'ai-credits.trigger');
const LAST_RUN = path.join(STATE, 'ai-credits.last-run');
const LOG = path.join(STATE, 'ai-credits.log');
const GH = process.env.GH_BIN ?? '/opt/homebrew/bin/gh';
if (!DRY) mkdirSync(STATE, { recursive: true });
const log = (msg) => {
  const line = `${new Date().toISOString()} ${DRY ? '[dry] ' : ''}${msg}`;
  console.log(line);
  if (!DRY) appendFileSync(LOG, line + '\n');
};
const mtime = (f) => { try { return statSync(f).mtimeMs; } catch { return null; } };
const readStatus = () => { try { return JSON.parse(readFileSync(STATUS_FILE, 'utf8')); } catch { return null; } };

const alertOnly = process.argv.includes('--alert-only') || isTriggerRun(mtime(TRIGGER_FILE), mtime(LAST_RUN));
log(`start mode=${alertOnly ? 'alert-only' : 'probe+alert'}`);

let status = readStatus();
if (!alertOnly) {
  const key = process.env.OPENAI_API_KEY?.trim();
  const base = (process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model = process.env.AI_CREDIT_PROBE_MODEL?.trim() || DEFAULT_PROBE_MODEL;
  let probe;
  if (!key) {
    probe = { error: new Error('OPENAI_API_KEY unset') };
  } else {
    try {
      const res = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ok' }], max_tokens: 1 }),
        signal: AbortSignal.timeout(30_000),
      });
      probe = { status: res.status, body: (await res.text()).slice(0, 2000) };
    } catch (error) {
      probe = { error };
    }
  }
  const result = classifyProbe(probe);
  const detail = probe.error ? `probe error: ${probe.error.message}` : `probe ${model} http ${probe.status}${result === 'ok' ? '' : ` ${probe.body.slice(0, 200)}`}`;
  log(`probe result=${result} (${detail})`);
  const next = nextStatus(readStatus(), result, detail, new Date().toISOString());
  if (next) {
    if (DRY) log(`would write status ${JSON.stringify(next)}`);
    else {
      // Atomic (temp + rename): the app reads and rewrites this file concurrently.
      const tmp = `${STATUS_FILE}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2) + '\n');
      renameSync(tmp, STATUS_FILE);
    }
    status = next; // dry runs still decide the alert from what the probe said
  }
}

const state = status?.status ?? null;
const streak = status?.unknownStreak ?? 0;

const token = process.env.GITHUB_TOKEN?.trim();
const repo = process.env.GITHUB_FEEDBACK_REPO?.trim();
let code = 0;
if (!token || !repo) {
  log('GITHUB_TOKEN/GITHUB_FEEDBACK_REPO unset — cannot alert');
  code = 2;
} else if (state === 'exhausted' || state === 'ok' || streak >= BLIND_THRESHOLD) {
  const gh = (...args) => {
    const r = spawnSync(GH, [...args, '-R', repo], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token } });
    if (r.status !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed: ${r.stderr.trim()}`);
    return r.stdout.trim();
  };
  const ghEnv = { env: { ...process.env, GH_TOKEN: token } };
  try {
    const open = JSON.parse(gh('issue', 'list', '-l', LABEL, '-s', 'open', '--json', 'number,title') || '[]');
    const creditIssues = open.filter(i => i.title !== BLIND_TITLE);
    const blindIssues = open.filter(i => i.title === BLIND_TITLE);

    const action = decideAlert({ state, hasOpenIssue: creditIssues.length > 0 });
    if (action === 'open') {
      if (DRY) log(`would open issue "${ISSUE_TITLE}"`);
      else {
        spawnSync(GH, ['label', 'create', LABEL, '-R', repo, '-c', 'B60205', '-d', "Clemson's shared OpenAI credits are used up"], ghEnv);
        gh('issue', 'create', '-t', ISSUE_TITLE, '-l', LABEL, '-b', issueBody(status));
        log('opened issue: credits exhausted');
      }
    } else if (action === 'close') {
      for (const i of creditIssues) {
        if (DRY) { log(`would comment on and close #${i.number}`); continue; }
        gh('issue', 'close', String(i.number), '-c', `Credits are available again (checked ${status.checkedAt}).`);
        log(`closed #${i.number}: credits available again`);
      }
    } else {
      log(`no credits alert action (state=${state}, open issues=${creditIssues.length})`);
    }

    const blind = decideBlind({ streak, state, hasOpenIssue: blindIssues.length > 0 });
    if (blind === 'open') {
      if (DRY) log(`would open issue "${BLIND_TITLE}"`);
      else {
        spawnSync(GH, ['label', 'create', LABEL, '-R', repo, '-c', 'B60205', '-d', "Clemson's shared OpenAI credits are used up"], ghEnv);
        gh('issue', 'create', '-t', BLIND_TITLE, '-l', LABEL, '-b', blindBody(status));
        log(`opened issue: monitor blind (${streak} unknown results in a row)`);
      }
    } else if (blind === 'close') {
      for (const i of blindIssues) {
        if (DRY) { log(`would close #${i.number}`); continue; }
        gh('issue', 'close', String(i.number), '-c', `The monitor reached a verdict again (${state}, checked ${status.checkedAt}).`);
        log(`closed #${i.number}: monitor sees credits again`);
      }
    }
  } catch (e) {
    log(`alert failed: ${e.message}`);
    code = 2;
  }
} else {
  log(`no alert action (state=${state ?? 'none'}, unknown streak=${streak})`);
}

if (!DRY) {
  if (!existsSync(LAST_RUN)) writeFileSync(LAST_RUN, '');
  const now = new Date();
  utimesSync(LAST_RUN, now, now);
}
process.exit(code);
