#!/usr/bin/env node
// Static, read-only snapshot of the public /wiki for the owner's Clemson web space
// (https://tonkin.people.clemson.edu/pages/gc-wiki/), which, unlike gcworkflow, is
// reachable off campus.
//
// Crawls the running app's public /wiki pages (no faculty slug), keeps them as
// server-rendered HTML, removes the app's scripts (the copy is not interactive),
// copies the CSS and fonts they use, and rewrites links so the copy is
// self-contained: /wiki/x/y -> x/y/index.html. Links outside /wiki point back to the
// live campus app.
//
// Dry run by default (writes to --out, default a temp dir); --apply writes to the
// mounted share.
//
//   node scripts/wiki/snapshot-public.mjs [--apply] [--origin http://127.0.0.1:3000] [--out <dir>]
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const apply = args.includes('--apply');
const origin = opt('--origin', 'http://127.0.0.1:3000');
const campus = 'https://gcworkflow.clemson.edu:8443';
const docsIndex = 'https://tonkin.people.clemson.edu/pages/gc-curriculum/';
let favicon = null;
const shareRoot = '/Volumes/people';
const out = apply
  ? opt('--out', '/Volumes/people/tonkin/pages/gc-wiki')
  : opt('--out', mkdtempSync(join(tmpdir(), 'gc-wiki-snapshot-')));

if (apply && !existsSync(shareRoot)) {
  console.error(`${shareRoot} is not mounted; connect to smb://people.zfs.clemson.edu/people first.`);
  process.exit(1);
}

/** /wiki -> index.html, /wiki/courses/gc-1010 -> courses/gc-1010/index.html */
const pageFile = route => posix.join(route.replace(/^\/wiki\/?/, ''), 'index.html');
/** /_next/static/media/a.woff2 -> _assets/media/a.woff2 */
const assetFile = route => route.replace(/^\/_next\/static\//, '_assets/');
const rel = (fromFile, toFile) => posix.relative(posix.dirname(fromFile) || '.', toFile) || posix.basename(toFile);

async function get(route) {
  const res = await fetch(origin + route, { redirect: 'manual' });
  if (res.status !== 200) throw new Error(`${route}: HTTP ${res.status}`);
  return res;
}
function write(file, data) {
  const p = join(out, file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, data);
}

const pages = new Set();
const queue = ['/wiki'];
const assets = new Set();

while (queue.length) {
  const route = queue.shift();
  if (pages.has(route)) continue;
  pages.add(route);
  let html = await (await get(route)).text();
  const file = pageFile(route);

  // Drop the app's scripts, preloads and the Next.js data payload: the copy is static.
  html = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<link\b[^>]*rel="(?:preload|modulepreload|prefetch)"[^>]*>/gi, '');

  html = html.replace(/(href|src)="([^"]*)"/g, (m, attr, url) => {
    if (url.startsWith('/_next/static/')) {
      assets.add(url.split('?')[0]);
      return `${attr}="${rel(file, assetFile(url.split('?')[0]))}"`;
    }
    const [path, hash = ''] = url.split('#');
    if (path === '' ) return m; // in-page anchor
    if (/^\/wiki(\/|$)/.test(path) && !path.includes('?')) {
      if (!/^\/wiki\/api\b/.test(path)) queue.push(path.replace(/\/$/, ''));
      return `${attr}="${rel(file, pageFile(path.replace(/\/$/, '')))}${hash ? '#' + hash : ''}"`;
    }
    if (path === '/') return `${attr}="${docsIndex}"`; // "Hub": the public documents index
    if (path.startsWith('/favicon.ico')) { favicon = path; return `${attr}="${rel(file, 'favicon.ico')}"`; }
    if (path.startsWith('/')) return `${attr}="${campus}${url}"`; // faculty-only app pages: live campus app
    return m;
  });
  write(file, html);
}

// CSS (and the fonts/images the CSS references).
for (const route of [...assets]) {
  const res = await get(route);
  const file = assetFile(route);
  if (route.endsWith('.css')) {
    let css = await res.text();
    css = css.replace(/url\((['"]?)([^)'"]+)\1\)/g, (m, q, url) => {
      if (/^(?:data:|https?:|#)/.test(url)) return m;
      const abs = url.startsWith('/') ? url : posix.normalize(posix.join(posix.dirname(route), url));
      if (!abs.startsWith('/_next/static/')) return m;
      assets.add(abs);
      return `url(${q}${rel(file, assetFile(abs))}${q})`;
    });
    write(file, css);
  } else {
    write(file, Buffer.from(await res.arrayBuffer()));
  }
}
// Fetch any fonts discovered while rewriting CSS.
for (const route of [...assets]) {
  if (route.endsWith('.css') || existsSync(join(out, assetFile(route)))) continue;
  write(assetFile(route), Buffer.from(await (await get(route)).arrayBuffer()));
}

if (favicon) write('favicon.ico', Buffer.from(await (await get(favicon.split('?')[0])).arrayBuffer()));

console.log(`mode: ${apply ? 'APPLY' : 'DRY RUN'}  out: ${out}`);
console.log(`${pages.size} pages, ${assets.size} assets`);
if (!apply) console.log('(dry run: nothing written to the share)');
