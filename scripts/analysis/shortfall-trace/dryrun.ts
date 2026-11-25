/**
 * Writes a clearly synthetic worksheet CSV pair from an extract, for an end-to-end dry run.
 * required = best captured depth on the path + 1 on every dimension that has a reading (cap 5);
 * every catalog link (prereq and concurrent_ok) is real for every non-foundational competency;
 * expected incoming = the earlier course's exit (blank when that course is not captured).
 * Usage: pnpm tsx scripts/analysis/shortfall-trace/dryrun.ts <extract.json> <out-dir>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Extract } from './extract-build';

const q = (v: string | number | null) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (rows: Array<Array<string | number | null>>) => rows.map(r => r.map(q).join(',')).join('\n') + '\n';

export function dryRunSheets(x: Extract) {
  const known = (code: string) => x.courses.find(c => c.code === code)!;
  const req: Array<Array<string | number | null>> = [['Competency', 'Weight for this target', 'Foundational?', 'Best depth on the path today (reference)', 'Required K', 'Required U', 'Required D', 'Notes']];
  for (const c of x.competencies) {
    const best = { k: null as number | null, u: null as number | null, d: null as number | null };
    for (const course of x.courses) {
      const d = course.captured ? course.depths[c.id] : undefined;
      if (!d) continue;
      for (const dim of ['k', 'u', 'd'] as const) if (d[dim] != null) best[dim] = Math.max(best[dim] ?? 0, d[dim]!);
    }
    const up = (v: number | null) => (v == null ? null : Math.min(5, v + 1));
    req.push([c.name, c.weight, c.foundational ? 'Yes (Do only)' : 'No', `K${best.k ?? '-'}/U${best.u ?? '-'}/D${best.d ?? '-'}`, c.foundational ? 'n/a' : up(best.k), c.foundational ? 'n/a' : up(best.u), up(best.d), 'DRY RUN: best today + 1']);
  }
  const links: Array<Array<string | number | null>> = [['Later course', 'Earlier course', 'Competency', 'Earlier course leaves at (reference)', 'Later course leaves at (reference)', 'Link real for this competency? (Yes/No)', 'Expected incoming K', 'Expected incoming U', 'Expected incoming D', 'Notes']];
  for (const e of x.prereqs.filter(p => p.kind === 'prereq' || p.kind === 'concurrent_ok')) {
    for (const c of x.competencies.filter(k => !k.foundational)) {
      const earlier = known(e.prereq);
      const d = earlier.captured ? earlier.depths[c.id] : undefined;
      links.push([`${e.course} ${known(e.course).title}`, `${e.prereq} ${earlier.title}`, c.name, '', '', 'Yes', d?.k ?? null, d?.u ?? null, d?.d ?? null, 'DRY RUN: expected = earlier course exit']);
    }
  }
  return { required: csv(req), links: csv(links) };
}

if (process.argv[1]?.endsWith('dryrun.ts')) {
  const [input, dir] = process.argv.slice(2);
  if (!input || !dir) throw new Error('usage: dryrun.ts <extract.json> <out-dir>');
  const s = dryRunSheets(JSON.parse(readFileSync(input, 'utf8')) as Extract);
  writeFileSync(path.join(dir, 'DRY-RUN-required-depths.csv'), s.required);
  writeFileSync(path.join(dir, 'DRY-RUN-prerequisite-links.csv'), s.links);
  console.log(`wrote DRY RUN worksheet CSVs to ${dir}`);
}
