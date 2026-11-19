#!/usr/bin/env node
// Restyle guard: the visible words of a docs page must not change.
// Compares each page's visible text against a git ref (default: dev).
// Words removed or changed are failures; words added are listed for review
// (the new header, footer and cross-link cards add words).
// Also checks that every element id and every "needs confirmation" marker survives.
//
// Usage: node scripts/docs/check-restyle-text.mjs [--ref dev] docs/a.html [docs/b.html ...]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
let ref = 'dev';
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ref') ref = args[++i];
  else files.push(args[i]);
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', middot: '·', dagger: '†', rarr: '→', larr: '←', times: '×', minus: '−', le: '≤', ge: '≥', asymp: '≈', sect: '§', para: '¶', bull: '•', deg: '°', eacute: 'é', copy: '©' };
function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
function words(html) {
  const body = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg|title)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decode(body).split(/\s+/).filter(Boolean);
}
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const nv = (html) => (html.match(/class="nv"/g) || []).length;

// Longest-common-subsequence diff on word arrays (pages are < 50k words).
function diff(a, b) {
  const n = a.length, m = b.length;
  // Myers-lite: trim common prefix/suffix, then LCS on the middle.
  let s = 0;
  while (s < n && s < m && a[s] === b[s]) s++;
  let e = 0;
  while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
  const A = a.slice(s, n - e), B = b.slice(s, m - e);
  if (A.length * B.length > 4e8) return { removed: A, added: B, tooBig: true };
  const W = B.length + 1;
  const dp = new Uint32Array((A.length + 1) * W);
  for (let i = A.length - 1; i >= 0; i--)
    for (let j = B.length - 1; j >= 0; j--)
      dp[i * W + j] = A[i] === B[j] ? dp[(i + 1) * W + j + 1] + 1 : Math.max(dp[(i + 1) * W + j], dp[i * W + j + 1]);
  const removed = [], added = [];
  let i = 0, j = 0, rRun = [], aRun = [];
  const flush = () => { if (rRun.length) removed.push(rRun.join(' ')); if (aRun.length) added.push(aRun.join(' ')); rRun = []; aRun = []; };
  while (i < A.length && j < B.length) {
    if (A[i] === B[j]) { flush(); i++; j++; }
    else if (dp[(i + 1) * W + j] >= dp[i * W + j + 1]) rRun.push(A[i++]);
    else aRun.push(B[j++]);
  }
  while (i < A.length) rRun.push(A[i++]);
  while (j < B.length) aRun.push(B[j++]);
  flush();
  return { removed, added };
}

let failed = false;
for (const f of files) {
  const before = execFileSync('git', ['show', `${ref}:${f}`], { encoding: 'utf8', maxBuffer: 64e6 });
  const after = readFileSync(f, 'utf8');
  const { removed, added, tooBig } = diff(words(before), words(after));
  const lostIds = [...ids(before)].filter((x) => !ids(after).has(x));
  const nvB = nv(before), nvA = nv(after);
  const ok = !removed.length && !lostIds.length && nvA >= nvB;
  if (!ok) failed = true;
  console.log(`\n${ok ? 'PASS' : 'FAIL'} ${f}${tooBig ? ' (diff too large to align)' : ''}`);
  if (removed.length) console.log('  removed/changed:\n' + removed.map((r) => '    - ' + r.slice(0, 200)).join('\n'));
  if (lostIds.length) console.log('  lost ids: ' + lostIds.join(', '));
  if (nvA < nvB) console.log(`  needs-confirmation markers: ${nvB} -> ${nvA}`);
  if (added.length) console.log('  added (review):\n' + added.map((r) => '    + ' + r.slice(0, 200)).join('\n'));
}
process.exit(failed ? 1 : 0);
