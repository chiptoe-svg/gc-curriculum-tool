#!/usr/bin/env node
// Restyle guard: the visible words of a docs page must not change.
// Compares each page's visible text against a git ref (default: dev).
// Words removed or changed are failures; words added are listed for review
// (the new header, footer and cross-link cards add words).
// Also checks that every element id and every "needs confirmation" marker survives.
//
// Usage: node scripts/docs/check-restyle-text.mjs [--ref dev] [--allow-removed <regex>]... docs/a.html ...
//
// Owner-approved removals (2026-11-18): section-number signs ("§ 4" -> "04") are
// always allowed; the old dark rail's header label (e.g. "Clemson · Graphic
// Communications GC Curriculum Tool Research Deep Dive") is allowed only when
// passed explicitly with --allow-removed, so each page's removal is visible.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
let ref = 'dev';
const files = [];
const allowRemoved = [/^§ ?\d+$/, /^§$/];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ref') ref = args[++i];
  else if (args[i] === '--allow-removed') allowRemoved.push(new RegExp(args[++i]));
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

// Longest-common-subsequence diff on word arrays.
function diffBase(a, b) {
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

// Long pages (e.g. background.html, ~36k words) exceed the LCS table, so they are
// first split at 10-word runs that occur exactly once on each side, kept in order
// (longest increasing subsequence), and only the gaps between anchors are diffed.
function diff(a, b) {
  if (a.length * b.length <= 4e8) return diffBase(a, b);
  const K = 10;
  const key = (w, i) => w.slice(i, i + K).join(' ');
  const once = (w) => { const m = new Map(); for (let i = 0; i + K <= w.length; i++) { const k = key(w, i); m.set(k, m.has(k) ? -1 : i); } return m; };
  const ma = once(a), mb = once(b);
  const pairs = [];
  for (const [k, i] of ma) if (i >= 0 && mb.get(k) >= 0) pairs.push([i, mb.get(k)]);
  pairs.sort((x, y) => x[0] - y[0]);
  const tails = [], prev = [];
  pairs.forEach((p, n) => {
    let lo = 0, hi = tails.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (pairs[tails[mid]][1] < p[1]) lo = mid + 1; else hi = mid; }
    prev[n] = lo ? tails[lo - 1] : -1; tails[lo] = n;
  });
  const chain = [];
  for (let n = tails[tails.length - 1]; n !== undefined && n >= 0; n = prev[n]) chain.push(pairs[n]);
  chain.reverse();
  const removed = [], added = [];
  let pa = 0, pb = 0, tooBig = false;
  const gap = (ea, eb) => { const d = diffBase(a.slice(pa, ea), b.slice(pb, eb)); removed.push(...d.removed); added.push(...d.added); tooBig ||= !!d.tooBig; };
  for (const [i, j] of chain) { if (i < pa || j < pb) continue; gap(i, j); pa = i + K; pb = j + K; }
  gap(a.length, b.length);
  return { removed, added, tooBig };
}

let failed = false;
for (const f of files) {
  const before = execFileSync('git', ['show', `${ref}:${f}`], { encoding: 'utf8', maxBuffer: 64e6 });
  const after = readFileSync(f, 'utf8');
  const d = diff(words(before), words(after));
  const { added, tooBig } = d;
  const allowed = d.removed.filter((r) => allowRemoved.some((re) => re.test(r)));
  const removed = d.removed.filter((r) => !allowRemoved.some((re) => re.test(r)));
  const lostIds = [...ids(before)].filter((x) => !ids(after).has(x));
  const nvB = nv(before), nvA = nv(after);
  const ok = !removed.length && !lostIds.length && nvA >= nvB;
  if (!ok) failed = true;
  console.log(`\n${ok ? 'PASS' : 'FAIL'} ${f}${tooBig ? ' (diff too large to align)' : ''}`);
  if (allowed.length) console.log('  removed (allowed):\n' + allowed.map((r) => '    ~ ' + r.slice(0, 200)).join('\n'));
  if (removed.length) console.log('  removed/changed:\n' + removed.map((r) => '    - ' + r.slice(0, 200)).join('\n'));
  if (lostIds.length) console.log('  lost ids: ' + lostIds.join(', '));
  if (nvA < nvB) console.log(`  needs-confirmation markers: ${nvB} -> ${nvA}`);
  if (added.length) console.log('  added (review):\n' + added.map((r) => '    + ' + r.slice(0, 200)).join('\n'));
}
process.exit(failed ? 1 : 0);
