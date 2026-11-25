/** Reads the two faculty-worksheet tabs (CSV exports of the xlsx). Pure: takes text, returns data. */
import type { Depth, Link } from './model';

export interface CompRef { id: string; name: string; foundational: boolean }

/** RFC 4180 CSV: quoted fields, doubled quotes, embedded newlines, CRLF. Fully blank trailing lines are kept as empty-field rows only if they have commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const t = text.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (quoted) {
      if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== '') || r.length > 1);
}

function table(csv: string): Array<Record<string, string>> {
  const rows = parseCsv(csv);
  const head = rows[0]?.map(h => h.trim());
  if (!head) throw new Error('worksheet CSV is empty');
  return rows.slice(1).filter(r => r.some(c => c.trim() !== '')).map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

function col(row: Record<string, string>, start: string): string {
  const key = Object.keys(row).find(k => k.toLowerCase().startsWith(start.toLowerCase()));
  if (key == null) throw new Error(`worksheet column "${start}" not found`);
  return row[key]!;
}

/** Blank or "n/a" is not given (null). Otherwise a whole number 0-5. */
function depthCell(raw: string, where: string): number | null {
  const s = raw.trim();
  if (s === '' || /^n\/?a$/i.test(s)) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0 || n > 5) throw new Error(`${where}: "${raw}" is not a whole number between 0 and 5`);
  return n;
}

function compByName(name: string, comps: readonly CompRef[], where: string): CompRef {
  const hit = comps.find(c => c.name.trim().toLowerCase() === name.trim().toLowerCase());
  if (!hit) throw new Error(`${where}: competency "${name}" is not one of the extract's competencies`);
  return hit;
}

export function readRequired(csv: string, comps: readonly CompRef[]): { required: Record<string, Depth> } {
  const required: Record<string, Depth> = {};
  for (const row of table(csv)) {
    const name = col(row, 'Competency');
    if (!name) continue;
    const c = compByName(name, comps, 'Required depths');
    const where = `Required depths, ${name}`;
    required[c.id] = {
      k: c.foundational ? null : depthCell(col(row, 'Required K'), where),
      u: c.foundational ? null : depthCell(col(row, 'Required U'), where),
      d: depthCell(col(row, 'Required D'), where),
    };
  }
  return { required };
}

const codeOf = (s: string) => /^GC\s*\d{4}/i.exec(s.trim())?.[0].toUpperCase().replace(/^GC\s*/, 'GC ') ?? null;

export function readLinks(csv: string, comps: readonly CompRef[], courses: readonly string[]): { links: Link[]; warnings: string[] } {
  const links: Link[] = [];
  const warnings: string[] = [];
  for (const row of table(csv)) {
    if (!/^yes$/i.test(col(row, 'Link real'))) continue; // blank and No are not used
    const later = codeOf(col(row, 'Later course'));
    const earlier = codeOf(col(row, 'Earlier course'));
    const c = compByName(col(row, 'Competency'), comps, 'Prerequisite links');
    for (const [label, code, raw] of [['Later', later, col(row, 'Later course')], ['Earlier', earlier, col(row, 'Earlier course')]] as const) {
      if (!code || !courses.includes(code)) throw new Error(`Prerequisite links: ${label.toLowerCase()} course "${raw}" (${code ?? 'no code'}) is not on the path`);
    }
    if (c.foundational) { warnings.push(`Link ${earlier} -> ${later} on ${c.id} ignored: foundational competencies have no links`); continue; }
    const where = `Prerequisite links, ${later} <- ${earlier}, ${c.id}`;
    links.push({
      later: later!, earlier: earlier!, competency: c.id,
      expected: { k: depthCell(col(row, 'Expected incoming K'), where), u: depthCell(col(row, 'Expected incoming U'), where), d: depthCell(col(row, 'Expected incoming D'), where) },
    });
  }
  return { links, warnings };
}
