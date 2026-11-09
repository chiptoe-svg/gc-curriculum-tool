#!/usr/bin/env node
/**
 * Build docs/curriculum-map.html, the public curriculum map demo, from the
 * published wiki (owner, 2026-11-09). Everything shown comes from wiki pages:
 *   - courses: title, year (from the course number), stated objectives (the
 *     Syllabus section's course-sheet objectives) and discovered outcomes (the
 *     "Competencies developed" statements with their K/U/D);
 *   - competencies: the courses that build each one, at K/U/D (coverage scorer);
 *   - career targets: competencies by importance (provisional weights).
 * No AI, no database. Required depths for careers do not exist yet (they come
 * from employers through Position Capture), so the page shows none.
 *
 *   node scripts/docs/build-curriculum-map.mjs [--wiki <dir>]
 * Then publish with scripts/docs/publish-clemson.mjs (owner step).
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const wiki = argv.includes('--wiki') ? argv[argv.indexOf('--wiki') + 1] : (process.env.WIKI_REPO_PATH ?? '/Users/admin/projects/gc-curriculum-wiki');
const here = path.dirname(new URL(import.meta.url).pathname);
const TEMPLATE = path.join(here, 'curriculum-map.template.html');
const OUT = path.join(here, '../../docs/curriculum-map.html');

const TAG = /\s*\[(?:Source: [^\]]+|Synthesis|Catalog: [^\]]+)\]/g;
const clean = s => s.replace(TAG, '').replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2').replace(/\[\[([^\]]+)\]\]/g, '$1').replace(/\*\*/g, '').trim();
const fm = (text, key) => text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))?.[1]?.trim().replace(/^"|"$/g, '') ?? null;
const section = (text, heading) => {
  const lines = text.split('\n');
  const start = lines.findIndex(l => l.trim() === `## ${heading}`);
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  return lines.slice(start + 1, end < 0 ? undefined : end);
};
const pages = dir => readdirSync(path.join(wiki, dir)).filter(f => f.endsWith('.md') && f !== 'index.md')
  .map(f => ({ slug: f.replace(/\.md$/, ''), text: readFileSync(path.join(wiki, dir, f), 'utf8') }));
const codeOf = slug => slug.toUpperCase().replace(/^([A-Z]+)-/, '$1 ');

const courses = pages('courses').map(({ slug, text }) => {
  const syl = section(text, 'Syllabus');
  const oStart = syl.findIndex(l => /^\*\*Learning objectives:\*\*/.test(l.trim()));
  const stated = [];
  if (oStart >= 0) for (const l of syl.slice(oStart + 1)) { if (/^\*\*/.test(l.trim())) break; if (/^- /.test(l)) stated.push(clean(l.slice(2))); }
  const found = section(text, 'Competencies developed').filter(l => /^- /.test(l)).flatMap(l => {
    const m = l.slice(2).match(/^(.*?)\s+—\s+K(\d)\/U(\d)\/D(\d)/);
    return m ? [{ s: clean(m[1]), k: [+m[2], +m[3], +m[4]] }] : [];
  });
  const num = slug.match(/-(\d)/)?.[1];
  return { slug, code: codeOf(slug), title: fm(text, 'title') ?? slug, year: num ? Math.min(4, Math.max(1, +num)) : 4, stated, found };
}).sort((a, b) => a.code.localeCompare(b.code));
const known = new Set(courses.map(c => c.slug));

const competencies = Object.fromEntries(pages('competencies').map(({ slug, text }) => {
  const builds = section(text, 'Across the program').flatMap(l => {
    const m = l.match(/^- \[\[([^\]|]+)(?:\|[^\]]*)?\]\]\s+—\s+K(\d)\/U(\d)\/D(\d)/);
    return m && known.has(m[1]) ? [{ c: m[1], k: [+m[2], +m[3], +m[4]] }] : [];
  });
  return [slug, { title: fm(text, 'title') ?? slug, builds }];
}));

const GROUPS = [['Very or extremely important', 'very'], ['Important', 'important'], ['Somewhat important', 'somewhat']];
const targets = pages('targets').map(({ slug, text }) => {
  const body = section(text, 'Competencies by importance');
  const needs = [];
  let group = null;
  for (const l of body) {
    const h = l.match(/^### (.+)$/);
    if (h) { group = GROUPS.find(([name]) => name === h[1].trim())?.[1] ?? null; continue; }
    const m = l.match(/^- \[\[([^\]|]+)/);
    if (m && group && competencies[m[1]]) needs.push({ m: m[1], imp: group });
  }
  const what = clean(section(text, 'What this person does').find(l => l.trim()) ?? '');
  return { slug, title: fm(text, 'title') ?? slug, what, needs };
}).filter(t => t.needs.length);

const data = { builtFrom: `gc-curriculum-wiki`, builtAt: new Date().toISOString().slice(0, 10), courses, competencies, targets };
const html = readFileSync(TEMPLATE, 'utf8').replace('/*__DATA__*/null', JSON.stringify(data));
writeFileSync(OUT, html);
console.log(`wrote ${path.relative(process.cwd(), OUT)}: ${courses.length} courses, ${Object.keys(competencies).length} competencies, ${targets.length} career targets`);
