/**
 * Export the Graphic Communications BS recommended plan (term by term) and the General Education
 * requirements for every catalog year in the clemson-advising catalog.db, to a data file the curriculum
 * builder reads: lib/builder/data/degree-plans.json. Read-only on the catalog; never touches Postgres.
 *
 *   pnpm tsx scripts/catalog/export-degree-plans.ts [--db <path to catalog.db>]
 *
 * Rerun after the advising catalog is refreshed, and commit the JSON.
 */
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

type Row = Record<string, unknown>;
interface Db { prepare(sql: string): { all(...p: unknown[]): Row[] } }

const require = createRequire(import.meta.url);
const flag = process.argv.indexOf('--db');
const dbPath = flag > 0 ? process.argv[flag + 1]! : path.join(homedir(), 'projects/clemson-advising-mcp/core/db/catalog.db');
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (p: string, o: { readOnly: boolean }) => Db };
const db = new DatabaseSync(dbPath, { readOnly: true });

const PROGRAM = 'Graphic Communications, BS';
const list = (v: unknown): string[] => { try { const a = JSON.parse(String(v ?? '[]')); return Array.isArray(a) ? a.map(String) : []; } catch { return []; } };

const years: Record<string, unknown> = {};
for (const y of db.prepare('SELECT id, label FROM catalog_year ORDER BY label DESC').all()) {
  const prog = db.prepare('SELECT id, name, total_credits FROM program WHERE catalog_year_id = ? AND name = ? AND kind = ?').all(y.id, PROGRAM, 'major')[0];
  const genEd = db.prepare('SELECT name, min_credits, rules, allowed_courses, subcategories FROM gen_ed_category WHERE catalog_year_id = ? ORDER BY id').all(y.id)
    .map(g => ({
      name: String(g.name),
      minCredits: g.min_credits == null ? null : Number(g.min_credits),
      rules: g.rules ? String(g.rules) : null,
      allowed: list(g.allowed_courses),
      subcategories: (() => { try { return (JSON.parse(String(g.subcategories ?? '[]')) as Array<{ name: string; min_credits?: number; allowed_courses?: string[] }>)
        .map(s => ({ name: s.name, minCredits: s.min_credits ?? null, allowed: s.allowed_courses ?? [] })); } catch { return []; } })(),
    }));
  if (!prog) { years[String(y.label)] = { program: null, genEd }; continue; }
  const notes = new Map(db.prepare('SELECT number, text FROM footnote WHERE program_id = ?').all(prog.id).map(f => [String(f.number), String(f.text)]));
  const terms = db.prepare("SELECT id, label, credit_total FROM requirement_group WHERE program_id = ? AND kind = 'term' ORDER BY ordering").all(prog.id)
    .map(g => ({
      label: String(g.label),
      credits: g.credit_total == null ? null : Number(g.credit_total),
      items: db.prepare('SELECT kind, course_code, one_of, slot_type, credits, footnote_refs FROM plan_item WHERE group_id = ? ORDER BY ordering').all(g.id)
        .map(i => ({
          kind: i.kind === 'fixed_course' ? 'course' : i.kind === 'choice' ? 'choice' : 'slot',
          code: i.course_code ? String(i.course_code) : null,
          options: list(i.one_of),
          label: i.slot_type ? String(i.slot_type) : null,
          credits: i.credits == null ? null : Number(i.credits),
          notes: list(i.footnote_refs).map(r => notes.get(r) ?? '').filter(Boolean),
        })),
    }));
  years[String(y.label)] = { program: { name: String(prog.name), totalCredits: prog.total_credits == null ? null : Number(prog.total_credits), terms }, genEd };
}

const out = path.join(process.cwd(), 'lib/builder/data/degree-plans.json');
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ source: 'clemson-advising catalog.db', program: PROGRAM, years }, null, 1) + '\n');
console.log(`wrote ${out}: ${Object.entries(years).map(([k, v]) => `${k}${(v as { program: unknown }).program ? '' : ' (no GC plan)'}`).join(', ')}`);
