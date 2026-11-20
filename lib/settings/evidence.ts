/**
 * The evidence register behind /settings: one markdown file per model or search decision in
 * docs/benchmarks/, with frontmatter
 *
 *   title: …            date: YYYY-MM-DD
 *   applies: <function id | role:<role> | search:rerank | search:embedding>, …
 *   summary: one line shown under the setting
 *
 * Read from disk on each request (a handful of small files); a file that doesn't parse is skipped.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Evidence } from './evidence-lookup';
export { evidenceFor, evidenceForKey, type Evidence } from './evidence-lookup';

const DEFAULT_DIR = join(process.cwd(), 'docs', 'benchmarks');
const ID = /^[a-z0-9-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(id: string, raw: string): Evidence | null {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of (m[1] ?? '').split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) fields[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const { title, date, applies, summary } = fields;
  if (!title || !date || !DATE.test(date) || !applies || !summary) return null;
  return { id, title, date, applies: applies.split(',').map(s => s.trim()).filter(Boolean), summary, body: m[2] ?? '' };
}

export function loadEvidence(dir: string = DEFAULT_DIR): Evidence[] {
  if (!existsSync(dir)) return [];
  const list: Evidence[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.md')) continue;
    const id = name.slice(0, -3);
    if (!ID.test(id)) continue;
    try {
      const e = parse(id, readFileSync(join(dir, name), 'utf8'));
      if (e) list.push(e);
    } catch { /* unreadable file: skip */ }
  }
  return list.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
}

export function getEvidence(id: string, dir: string = DEFAULT_DIR): Evidence | null {
  if (!ID.test(id)) return null;
  return loadEvidence(dir).find(e => e.id === id) ?? null;
}
