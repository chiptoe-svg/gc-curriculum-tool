#!/usr/bin/env node
/**
 * Course-materials alert — daily (launchd com.gc.materials-check).
 *
 * Lists course materials that were not read: failed, still waiting a day after
 * upload, or deleted before they were read (2026-10-27: two GC 4400 uploads and
 * fourteen GC 3700 Canvas files were lost that way). Any such material -> one
 * GitHub issue labelled `materials-alert`, kept up to date; it closes once the
 * list is empty. Read-only on the database. Same alert channel and token as
 * scripts/cost/cost-cap-check.mjs.
 *
 * Env comes from the PRODUCTION checkout via @next/env (the app's own loader —
 * never hand-parsed). Usage: node scripts/materials/materials-check.mjs [--dry-run]
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ISSUE_TITLE, LABEL, classifyMaterial, decideAction, issueBody } from './materials-check-lib.mjs';

const DEPLOY = process.env.APP_DIR ?? path.join(homedir(), 'projects/curriculum_developer-deploy');
const require = createRequire(path.join(DEPLOY, 'package.json'));
// @next/env is a transitive dependency (pnpm keeps it out of node_modules' top level).
const store = path.join(DEPLOY, 'node_modules/.pnpm');
const nextEnvDir = readdirSync(store).find(d => d.startsWith('@next+env@'));
const { loadEnvConfig } = require(path.join(store, nextEnvDir, 'node_modules/@next/env'));
const { Client } = require('pg');
loadEnvConfig(DEPLOY, false, { info: () => {}, error: console.error });

const DRY = process.argv.includes('--dry-run');
const GH = process.env.GH_BIN ?? '/opt/homebrew/bin/gh';
const LOG = path.join(homedir(), '.local/state/gc-curriculum-tool/materials-check.log');
mkdirSync(path.dirname(LOG), { recursive: true });
const log = (msg) => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); appendFileSync(LOG, line + '\n'); };

const db = new Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const { rows } = await db.query(
  `SELECT course_code, file_name, blob_url, indexing_status, extraction_status,
          raw_cleared, ignored, retired_at, uploaded_at
     FROM course_materials
    WHERE NOT ignored AND retired_at IS NULL
      AND indexing_status IN ('failed', 'pending', 'queued', 'indexing')`,
);
await db.end();

const now = new Date();
const problems = rows
  .map(r => ({ ...r, uploaded_at: new Date(r.uploaded_at).toISOString(), kind: classifyMaterial(r, now) }))
  .filter(p => p.kind);
const counts = ['lost', 'failed', 'waiting'].map(k => `${k}=${problems.filter(p => p.kind === k).length}`).join(' ');
log(`check problems=${problems.length} ${counts}`);
const body = problems.length ? issueBody(problems) : '';
if (DRY && body) console.log(body);

const token = process.env.GITHUB_TOKEN?.trim();
const repo = process.env.GITHUB_FEEDBACK_REPO?.trim();
if (!token || !repo) { log('GITHUB_TOKEN/GITHUB_FEEDBACK_REPO unset — cannot alert'); process.exit(2); }
const ghEnv = { encoding: 'utf8', env: { ...process.env, GH_TOKEN: token } };
const gh = (...args) => {
  const r = spawnSync(GH, [...args, '-R', repo], ghEnv);
  if (r.status !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
};

const open = JSON.parse(gh('issue', 'list', '-l', LABEL, '-s', 'open', '--json', 'number,title,body') || '[]')[0] ?? null;
const action = decideAction(body, open);
if (DRY) {
  log(`DRY RUN: would ${action}${open ? ` issue #${open.number}` : ''}`);
  process.exit(0);
}
if (action === 'open') {
  spawnSync(GH, ['label', 'create', LABEL, '-R', repo, '-c', 'D93F0B', '-d', 'Course materials that could not be read'], ghEnv);
  gh('issue', 'create', '-t', ISSUE_TITLE, '-l', LABEL, '-b', body);
  log(`opened issue (${problems.length} materials)`);
} else if (action === 'update') {
  gh('issue', 'edit', String(open.number), '-b', body);
  log(`updated issue #${open.number} (${problems.length} materials)`);
} else if (action === 'close') {
  gh('issue', 'close', String(open.number), '-c', `Every course material has been read, removed or set aside (checked ${now.toISOString()}).`);
  log(`closed issue #${open.number}`);
} else {
  log('no alert action');
}
