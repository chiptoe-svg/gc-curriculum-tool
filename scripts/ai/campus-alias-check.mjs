#!/usr/bin/env node
/**
 * Daily check that the RCD campus aliases still point at the pinned models
 * (Part 2 Task 7). Sends a one-token request to each alias and to its pinned
 * id (campus models are free) and compares the `model` field each returns.
 * Opens one GitHub issue labelled `campus-alias` when an alias moves; closes it
 * when they match again. Scheduled 07:10 local by launchd com.gc.campus-alias-check.
 *   --dry-run   probes and lists issues, opens/closes nothing.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { ISSUE_TITLE, LABEL, PINNED, aliasMoved, decideIssue, issueBody } from './campus-alias-lib.mjs';

const DEPLOY = process.env.APP_DIR ?? path.join(homedir(), 'projects/curriculum_developer-deploy');
const require = createRequire(path.join(DEPLOY, 'package.json'));
const store = path.join(DEPLOY, 'node_modules/.pnpm');
const nextEnvDir = readdirSync(store).find(d => d.startsWith('@next+env@'));
const { loadEnvConfig } = require(path.join(store, nextEnvDir, 'node_modules/@next/env'));
loadEnvConfig(DEPLOY, false, { info: () => {}, error: console.error });

const DRY = process.argv.includes('--dry-run');
const GH = process.env.GH_BIN ?? '/opt/homebrew/bin/gh';
const log = msg => console.log(`${new Date().toISOString()} ${msg}`);

async function served(model) {
  const base = process.env.CAMPUS_LLM_BASE_URL?.trim().replace(/\/+$/, '');
  const key = process.env.CAMPUS_LLM_API_KEY?.trim();
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!res.ok) return null;
    return (await res.json()).model ?? null;
  } catch { return null; }
}

const checkedAt = new Date().toISOString();
const results = [];
for (const [alias, pinned] of Object.entries(PINNED)) {
  const [aliasServed, pinnedServed] = [await served(alias), await served(pinned)];
  results.push({ alias, pinned, aliasServed, pinnedServed, moved: aliasMoved(aliasServed, pinnedServed) });
}
for (const r of results) log(`${r.alias} -> ${r.aliasServed ?? '?'} | ${r.pinned} -> ${r.pinnedServed ?? '?'} | ${r.moved === null ? 'unknown' : r.moved ? 'MOVED' : 'same'}`);

const token = process.env.GITHUB_TOKEN?.trim();
const repo = process.env.GITHUB_FEEDBACK_REPO?.trim();
if (!token || !repo) { log('GITHUB_TOKEN/GITHUB_FEEDBACK_REPO unset — cannot alert'); process.exit(2); }
const env = { ...process.env, GH_TOKEN: token };
const gh = (...args) => {
  const r = spawnSync(GH, [...args, '-R', repo], { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`gh ${args[0]} ${args[1]} failed: ${r.stderr.trim()}`);
  return r.stdout.trim();
};
const open = JSON.parse(gh('issue', 'list', '-l', LABEL, '-s', 'open', '--json', 'number') || '[]');
const action = decideIssue(results, open.length > 0);
if (action === 'open') {
  if (DRY) log(`would open issue "${ISSUE_TITLE}"`);
  else {
    spawnSync(GH, ['label', 'create', LABEL, '-R', repo, '-c', 'FBCA04', '-d', 'An RCD campus alias serves a different model than its pinned id'], { env });
    gh('issue', 'create', '-t', ISSUE_TITLE, '-l', LABEL, '-b', issueBody(results, checkedAt));
    log('opened issue: alias moved');
  }
} else if (action === 'close') {
  for (const i of open) {
    if (DRY) { log(`would close #${i.number}`); continue; }
    gh('issue', 'close', String(i.number), '-c', `The aliases match the pinned models again (checked ${checkedAt}).`);
    log(`closed #${i.number}`);
  }
} else log(`no issue action (open issues=${open.length})`);
