#!/usr/bin/env node
// Publish the public documents to the owner's Clemson personal web space
// (https://tonkin.people.clemson.edu/pages/gc-curriculum/), replacing GitHub Pages.
//
// Starts from every git-tracked .html under docs/ outside docs/superpowers/, follows
// relative href/src links (recursively through linked .html), and copies the result
// to the mounted share, keeping paths relative to docs/. Only git-tracked files are
// ever copied, so git-ignored material (e.g. docs/references/_pdfs) can't leak.
//
// Dry run by default; --apply copies. The share must be mounted first
// (Finder → Go → Connect to Server → smb://people.zfs.clemson.edu/people).
//
//   node scripts/docs/publish-clemson.mjs [--apply] [--dest <dir>]
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const destIdx = args.indexOf('--dest');
const dest = destIdx >= 0 ? args[destIdx + 1] : '/Volumes/people/tonkin/pages/gc-curriculum';
const shareRoot = '/Volumes/people';

const tracked = new Set(
  execFileSync('git', ['ls-files', 'docs'], { encoding: 'utf8' }).split('\n').filter(Boolean),
);
const entries = [...tracked].filter(f => f.endsWith('.html') && !f.startsWith('docs/superpowers/'));
// The original May 2026 spec lives at the repo root; README links it. Published flat.
const ROOT_EXTRAS = ['gc-curriculum-tool-spec.html'];
const outPath = f => (f.startsWith('docs/') ? relative('docs', f) : f);

// Published pages link to the Clemson copies, not GitHub or the campus app (owner,
// 2026-10-15). Rewritten at copy time so sources (including ai_career's generated
// papers) need no change. Faculty-only app pages and the code repository stay as is.
const BASE = 'https://tonkin.people.clemson.edu/pages/gc-curriculum/';
const WIKI_BASE = 'https://tonkin.people.clemson.edu/pages/gc-wiki/';
const BLOB = /https:\/\/github\.com\/chiptoe-svg\/gc-curriculum-tool\/blob\/main\/docs\/([^"#?\s)]+)/g;
function rewriteLinks(html) {
  return html
    .replaceAll('https://chiptoe-svg.github.io/gc-curriculum-tool/docs/', BASE)
    .replaceAll('https://chiptoe-svg.github.io/gc-curriculum-tool/', BASE)
    .replace(BLOB, (m, p) => (tracked.has('docs/' + p) ? BASE + p : m))
    .replace(/https:\/\/gcworkflow\.clemson\.edu:8443\/wiki(\/[a-z]+\/[a-z0-9-]+|\/guide)?\/?(?=["#])/g,
      (m, p) => WIKI_BASE + (p ? p.slice(1) + '/' : ''));
}

const files = new Set();
const missing = [];
const queue = [...entries];
while (queue.length) {
  const f = queue.shift();
  if (files.has(f)) continue;
  files.add(f);
  if (!f.endsWith('.html')) continue;
  const html = readFileSync(f, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const ref = m[1].split('#')[0].split('?')[0];
    if (!ref || /^(?:[a-z]+:|\/\/|\/)/i.test(ref)) {
      const blob = /^https:\/\/github\.com\/chiptoe-svg\/gc-curriculum-tool\/blob\/main\/(docs\/.+)$/.exec(ref);
      if (blob && tracked.has(blob[1])) queue.push(blob[1]); // published so the rewritten link resolves
      continue;
    }
    const target = normalize(join(dirname(f), decodeURI(ref)));
    if (!target.startsWith('docs/')) { missing.push(`${f} -> ${ref} (outside docs/)`); continue; }
    if (!tracked.has(target)) { missing.push(`${f} -> ${ref} (not tracked)`); continue; }
    queue.push(target);
  }
}

const list = [...files, ...ROOT_EXTRAS].sort();
console.log(`mode: ${apply ? 'APPLY' : 'DRY RUN'}  dest: ${dest}`);
for (const f of list) console.log(`  ${outPath(f)}`);
console.log(`${list.length} files`);
if (missing.length) {
  console.log('skipped links:');
  for (const m of missing) console.log(`  ${m}`);
}

if (apply) {
  // Only touch the share when writing to it (a local --dest never needs it).
  if (dest.startsWith(shareRoot) && (!existsSync(shareRoot) || !statSync(shareRoot).isDirectory())) {
    console.error(`${shareRoot} is not mounted; connect to smb://people.zfs.clemson.edu/people first.`);
    process.exit(1);
  }
  for (const f of list) {
    const out = join(dest, outPath(f));
    mkdirSync(dirname(out), { recursive: true });
    if (f.endsWith('.html')) writeFileSync(out, rewriteLinks(readFileSync(f, 'utf8')));
    else copyFileSync(f, out);
  }
  // Apache serves .md as text/markdown, which browsers download; show it as text.
  writeFileSync(join(dest, '.htaccess'), 'AddType "text/plain; charset=UTF-8" .md\n');
  console.log(`copied ${list.length} files`);
}
