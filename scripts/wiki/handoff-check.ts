#!/usr/bin/env tsx
/**
 * Wiki handoff check (project skill trail plan, Task 5b). Validates a folder
 * of Opus-written wiki replies before round 2 commits them: every reply has a
 * matching request, parses, passes the app's own validateWikiUpdateOutput, and
 * contains every page its request asked for (a missing page would make the
 * pipeline re-request and leave the unit uncommitted). Read-only.
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs scripts/wiki/handoff-check.ts --dir <handoff dir>
 *
 * Exit codes: 0 every reply OK · 1 any reply fails · 2 bad args.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { validateWikiUpdateOutput } from '@/lib/ai/wiki/update';
import { isMainModule } from '@/scripts/catalog/catalog-source';

const keysIn = (d: string) => (existsSync(d) ? readdirSync(d).filter(f => f.endsWith('.json')).map(f => f.slice(0, -5)).sort() : []);

export function checkHandoffDir(dir: string): { ok: boolean; lines: string[]; pending: string[] } {
  const requests = new Set(keysIn(path.join(dir, 'requests')));
  const responses = keysIn(path.join(dir, 'responses'));
  const lines: string[] = [];
  let ok = true;
  for (const key of responses) {
    const fail = (why: string) => { ok = false; lines.push(`${key} FAIL: ${why}`); };
    if (!requests.has(key)) { fail('no matching request'); continue; }
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(path.join(dir, 'responses', `${key}.json`), 'utf8')); } catch { fail('invalid JSON'); continue; }
    let pages: Array<{ path: string }>;
    try { pages = validateWikiUpdateOutput(raw).pages; } catch (err) { fail(err instanceof Error ? err.message : String(err)); continue; }
    const req = JSON.parse(readFileSync(path.join(dir, 'requests', `${key}.json`), 'utf8')) as { userMessage: string };
    const wanted = ((JSON.parse(req.userMessage) as { affectedWikiPages?: Array<{ path: string }> }).affectedWikiPages ?? []).map(p => p.path);
    const got = new Set(pages.map(p => p.path));
    const missing = wanted.filter(p => !got.has(p));
    if (missing.length) { fail(`missing page(s): ${missing.join(', ')}`); continue; }
    lines.push(`${key} OK (${pages.length} page${pages.length === 1 ? '' : 's'})`);
  }
  const answered = new Set(responses);
  const pending = [...requests].filter(k => !answered.has(k));
  return { ok, lines, pending };
}

export function main(argv: string[]): number {
  const i = argv.indexOf('--dir');
  const dir = i >= 0 ? argv[i + 1] : undefined;
  if (!dir) { console.error('usage: --dir <handoff dir>'); return 2; }
  const r = checkHandoffDir(dir);
  for (const l of r.lines) console.log(l);
  console.log(`${r.lines.length} repl${r.lines.length === 1 ? 'y' : 'ies'} checked · ${r.pending.length} request(s) still without a reply${r.pending.length ? `: ${r.pending.join(', ')}` : ''}`);
  return r.ok ? 0 : 1;
}

if (isMainModule(import.meta.url, process.argv[1])) process.exit(main(process.argv.slice(2)));
