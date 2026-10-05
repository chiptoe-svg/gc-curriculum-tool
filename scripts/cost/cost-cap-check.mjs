#!/usr/bin/env node
/**
 * AI-spend alert — warn, never block (owner decision 2026-10-05: "ignore the
 * $ cap — warn me but don't stop anything").
 *
 * Hourly (launchd com.gc.cost-cap-check). Reads today's spend from
 * `daily_cost` and the cap from DAILY_COST_CAP_USD. Over the cap → opens a
 * GitHub issue labelled `cost-alert` (one per day; later hours in the same day
 * add a comment only when spend has grown by at least another cap's worth).
 * An open issue from an earlier day is closed once today is back under the cap.
 * Same alert channel and token as scripts/backup/backup-age-check.sh.
 *
 * Env comes from the PRODUCTION checkout via @next/env (the app's own loader —
 * never hand-parsed). Usage: node scripts/cost/cost-cap-check.mjs [--dry-run]
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';

const DEPLOY = process.env.APP_DIR ?? path.join(homedir(), 'projects/curriculum_developer-deploy');
const require = createRequire(path.join(DEPLOY, 'package.json'));
// @next/env is a transitive dependency (pnpm keeps it out of node_modules' top level).
const store = path.join(DEPLOY, 'node_modules/.pnpm');
const nextEnvDir = readdirSync(store).find(d => d.startsWith('@next+env@'));
const { loadEnvConfig } = require(path.join(store, nextEnvDir, 'node_modules/@next/env'));
const { Client } = require('pg');
loadEnvConfig(DEPLOY, false, { info: () => {}, error: console.error });

const DRY = process.argv.includes('--dry-run');
const LABEL = 'cost-alert';
const GH = process.env.GH_BIN ?? '/opt/homebrew/bin/gh';
const LOG = path.join(homedir(), '.local/state/gc-curriculum-tool/cost-cap.log');
mkdirSync(path.dirname(LOG), { recursive: true });
const log = (msg) => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); appendFileSync(LOG, line + '\n'); };

const capUsd = Number(process.env.DAILY_COST_CAP_USD ?? '5');
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query('SELECT COALESCE(total_cost_usd_cents,0)::bigint AS spent FROM daily_cost WHERE day = $1', [today]);
await db.end();
const spentUsd = Number(rows[0]?.spent ?? 0) / 10_000; // stored in 1/100-cent units
const over = spentUsd >= capUsd;
log(`check day=${today} spent=$${spentUsd.toFixed(2)} cap=$${capUsd.toFixed(2)} mode=${process.env.DAILY_COST_CAP_MODE ?? 'block'} over=${over}`);

const token = process.env.GITHUB_TOKEN?.trim();
const repo = process.env.GITHUB_FEEDBACK_REPO?.trim();
if (!token || !repo) { log('GITHUB_TOKEN/GITHUB_FEEDBACK_REPO unset — cannot alert'); process.exit(2); }
const gh = (...args) => {
  const r = spawnSync(GH, [...args, '-R', repo], { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token } });
  if (r.status !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

const open = JSON.parse(gh('issue', 'list', '-l', LABEL, '-s', 'open', '--json', 'number,title,body') || '[]');
const todays = open.find(i => i.title.includes(today));
const fmt = (n) => `$${n.toFixed(2)}`;

if (over) {
  const multiple = Math.floor(spentUsd / capUsd);
  if (DRY) { log(`DRY: would ${todays ? `consider a comment on #${todays.number}` : 'open an issue'}`); process.exit(1); }
  spawnSync(GH, ['label', 'create', LABEL, '-R', repo, '-c', 'D93F0B', '-d', 'Daily AI spend over the cap (warning only)'], { env: { ...process.env, GH_TOKEN: token } });
  const body = `AI spend on ${hostname()} for ${today} is **${fmt(spentUsd)}**, over the ${fmt(capUsd)} daily cap.\n\n`
    + `The cap is in **warn-only** mode (DAILY_COST_CAP_MODE=warn): nothing was stopped. `
    + `Check what is running if this is unexpected (coverage re-scoring, ingestion, interviews).\n\n<!-- multiple:${multiple} -->`;
  if (!todays) {
    gh('issue', 'create', '-t', `AI spend ${fmt(spentUsd)} on ${today} (over ${fmt(capUsd)} cap)`, '-l', LABEL, '-b', body);
    log(`opened issue: over cap (${multiple}× cap)`);
  } else {
    const prev = Number(/multiple:(\d+)/.exec(todays.body ?? '')?.[1] ?? 1);
    if (multiple > prev) {
      gh('issue', 'comment', String(todays.number), '-b', `Now ${fmt(spentUsd)} (${multiple}× the cap) at ${new Date().toISOString()}.`);
      gh('issue', 'edit', String(todays.number), '-b', body);
      log(`commented on #${todays.number}: now ${multiple}× cap`);
    }
  }
  process.exit(1);
}

// Under the cap today: close alerts from earlier days.
for (const i of open.filter(i => !i.title.includes(today))) {
  if (DRY) { log(`DRY: would close #${i.number}`); continue; }
  gh('issue', 'close', String(i.number), '-c', `Closed automatically: spend for ${today} is ${fmt(spentUsd)}, under the ${fmt(capUsd)} cap.`);
  log(`closed #${i.number}`);
}
