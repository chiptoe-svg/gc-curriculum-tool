#!/usr/bin/env tsx
/**
 * Project skill trail — read-only similarity report for choosing
 * TRAIL_SIMILARITY_FLOOR (spec 2026-10-22-project-skill-trail-design.md §2).
 * For every linked (course skill, competency) pair on the latest snapshots:
 * the 5 nearest bundle items with no floor, then a histogram of the best
 * similarity per pair. Writes nothing; no AI calls.
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/project-trail-report.ts --expect-db <name> [--limit 40]
 *
 * Exit codes: 0 ok · 1 wrong database or failure · 2 bad args.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';
import { loadProjectTrail } from '@/lib/db/project-trail-queries';
import type { TrailItem } from '@/lib/catalog/project-trail';
import type { Executor } from '@/lib/db/bundle-queries';

export interface ReportPair { courseCode: string; statement: string; competencyId: string; items: TrailItem[] }

async function loadPairs(ex: Executor): Promise<ReportPair[]> {
  const snaps = (await ex.execute(sql`
    SELECT DISTINCT ON (course_code) id, course_code AS code FROM course_capture_snapshots
    WHERE retired_at IS NULL ORDER BY course_code, created_at DESC`)).rows as Array<{ id: string; code: string }>;
  const out: ReportPair[] = [];
  const seen = new Set<string>();
  for (const s of snaps) {
    for (const p of await loadProjectTrail(ex, s.id, { floor: 0, n: 5 })) {
      for (const skill of p.skills) for (const c of skill.competencies) {
        const k = `${s.code}|${skill.statement}|${c.id}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ courseCode: s.code, statement: skill.statement, competencyId: c.id, items: c.onet });
      }
    }
  }
  return out;
}

export function formatReport(pairs: ReportPair[], limit: number): string {
  const out: string[] = [];
  for (const p of pairs.slice(0, limit)) {
    out.push(`${p.courseCode} · ${p.statement} → ${p.competencyId}`);
    if (p.items.length === 0) out.push('    no embedded items');
    for (const i of p.items) out.push(`    ${i.similarity.toFixed(2)}  ${i.label}${i.provisional ? ' (provisional)' : ''}`);
  }
  const best = pairs.filter(p => p.items.length > 0).map(p => p.items[0]!.similarity);
  out.push('', `Best similarity per pair (${best.length} of ${pairs.length} pairs have embedded items):`);
  for (let lo = 0; lo < 1; lo += 0.05) {
    const hi = lo + 0.05;
    const n = best.filter(b => b >= lo - 1e-9 && b < hi - 1e-9).length;
    if (n > 0) out.push(`  ${lo.toFixed(2)}–${hi.toFixed(2)}: ${n}`);
  }
  return out.join('\n');
}

export async function main(argv: string[], deps: { load?: (ex: Executor) => Promise<ReportPair[]> } = {}): Promise<number> {
  const i = argv.indexOf('--expect-db');
  const expectDb = i >= 0 ? argv[i + 1] : undefined;
  if (!expectDb) {
    console.error('usage: --expect-db <name> [--limit 40]');
    return 2;
  }
  const li = argv.indexOf('--limit');
  const limit = li >= 0 ? Number(argv[li + 1]) : 40;
  try {
    await assertExpectedDb(expectDb, db);
  } catch (err) {
    console.error(formatDbError(err));
    return 1;
  }
  try {
    const pairs = await (deps.load ?? loadPairs)(db);
    console.log(`READ ONLY expect-db: ${expectDb} · ${pairs.length} linked (skill, competency) pairs`);
    console.log(formatReport(pairs, Number.isFinite(limit) ? limit : 40));
    return 0;
  } catch (err) {
    console.error(formatDbError(err));
    return 1;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
