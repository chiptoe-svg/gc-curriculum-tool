#!/usr/bin/env tsx
/**
 * P2 Task 9 — read-only agreement report: the AI's placements vs the blind
 * reviewer's picks for every SUBMITTED golden sample (spec §5). Counts come
 * first; precision/recall are rough at n = 8. Nothing is auto-confirmed in
 * P2, whatever these figures say. Writes nothing.
 *
 * Usage (from the repo root, with DATABASE_URL set explicitly — get a
 * scratch URL via scripts/migrations/p2-scratch-db.sh url):
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/bundle-agreement-report.ts --expect-db gc_curriculum_p2_scratch
 *
 * Exit codes: 2 = bad args, 1 = wrong database, 3 = read failure.
 */
import { db } from '@/lib/db/client';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb, type P1Executor } from '@/scripts/catalog/catalog-source';
import { computeAgreement, sumAgreement, cohenKappa, type AgreementRow } from '@/lib/catalog/agreement';
import { readAgreementInputs } from '@/lib/db/bundle-queries';
import { TASK_SHORTLIST_K } from '@/lib/ai/catalog/map-bundle-onet';
import { getOnetReleaseMetadata } from '@/lib/onet/load';

export interface ReportData {
  rows: AgreementRow[];
  kappas: Array<{ bundleId: string; kappa: number | null }>;
  noMatch: Array<{ bundleId: string; note: string | null }>;
}

const pct = (x: number | null): string => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

function rowLines(r: AgreementRow): string[] {
  return [
    `${r.bundleId}`,
    `  AI placed ${r.aiCount}, reviewer placed ${r.blindCount}, both ${r.both}, exact ${r.exact}, within one ${r.withinOne}, reviewer tasks outside top-${TASK_SHORTLIST_K} ${r.blindTasksOutsideShortlist}`,
    `  precision ${pct(r.precision)}, recall ${pct(r.recall)}`,
  ];
}

/** Pure: renders the report text. */
export function formatReport(data: ReportData): string {
  const out: string[] = [];
  out.push(`Bundle agreement report — blind sample (n = ${data.rows.length} bundles; percentages are rough at this size)`);
  out.push('');
  for (const r of data.rows) out.push(...rowLines(r));
  out.push('');
  out.push(...rowLines(sumAgreement(data.rows)));
  out.push('');
  if (data.kappas.length === 0) {
    out.push("Cohen's κ: needs a second blind reviewer");
  } else {
    for (const k of data.kappas) out.push(`Cohen's κ ${k.bundleId}: ${k.kappa === null ? 'n/a' : k.kappa.toFixed(2)}`);
  }
  out.push('');
  out.push(`No clean match (ESCO to-do): ${data.noMatch.length === 0 ? 'none' : ''}`.trimEnd());
  for (const n of data.noMatch) out.push(`  - ${n.bundleId}${n.note ? ` — ${n.note}` : ''}`);
  out.push('');
  out.push('Nothing is auto-confirmed in P2, whatever these figures say.');
  out.push('');
  out.push(getOnetReleaseMetadata('31.0').attribution);
  return out.join('\n');
}

export async function main(argv: string[], deps: { executor?: P1Executor } = {}): Promise<number> {
  const i = argv.indexOf('--expect-db');
  const expectDb = i >= 0 ? argv[i + 1] : undefined;
  if (!expectDb) {
    console.error('usage: --expect-db <name>');
    return 2;
  }
  const executor = deps.executor ?? db;
  try {
    await assertExpectedDb(expectDb, executor);
  } catch (err) {
    console.error(formatDbError(err));
    return 1;
  }
  try {
    const { inputs, noMatch, secondReviewerPairs } = await readAgreementInputs(executor);
    console.log(formatReport({
      rows: inputs.map(computeAgreement),
      kappas: secondReviewerPairs.map(p => ({ bundleId: p.bundleId, kappa: cohenKappa(p.a, p.b) })),
      noMatch,
    }));
  } catch (err) {
    console.error(formatDbError(err));
    return 3;
  }
  return 0;
}

if (isMainModule(import.meta.url, process.argv[1])) {
  loadAppEnv();
  void main(process.argv.slice(2)).then(code => process.exit(code));
}
