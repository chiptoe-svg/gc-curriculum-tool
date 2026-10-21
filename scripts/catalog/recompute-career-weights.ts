#!/usr/bin/env tsx
/**
 * P3 — recompute career weights (spec 2026-10-21-p3-career-weights-design.md).
 * Deterministic, no AI. Dry run by default (computes, prints, writes nothing);
 * --apply writes the onet/employer rows in one transaction.
 *
 *   node node_modules/.pnpm/tsx@4.22.0/node_modules/tsx/dist/cli.mjs \
 *     scripts/catalog/recompute-career-weights.ts --expect-db <name> [--apply]
 *
 * Exit codes: 0 ok · 1 wrong database or failure · 2 bad args.
 */
import { db } from '@/lib/db/client';
import { loadAppEnv, isMainModule, formatDbError, assertExpectedDb } from '@/scripts/catalog/catalog-source';
import { recomputeCareerWeights, type RecomputeReport, type Executor } from '@/lib/db/career-weight-queries';

const f2 = (x: number | null) => (x === null ? 'n/a' : x.toFixed(2));

export function formatReport(r: RecomputeReport): string {
  const out = [`pairs ${r.pairs} · onet rows ${r.onetUpserted} (deleted ${r.onetDeleted}) · employer rows ${r.employerUpserted} (deleted ${r.employerDeleted})`];
  for (const b of r.byTarget) out.push(`  ${b.targetId} ${b.horizon}: ${b.members} members, ${b.withOnet} with an O*NET weight, min ${f2(b.onetMin)} median ${f2(b.onetMedian)} max ${f2(b.onetMax)}`);
  if (r.nonMemberCandidates.length > 0) {
    out.push('O*NET weight above 0.5 but not members of the target (faculty decide; nothing written):');
    for (const c of r.nonMemberCandidates) out.push(`  ${c.competencyId} (${c.targetId} ${c.horizon}, ${c.onet.toFixed(2)})`);
  }
  return out.join('\n');
}

export async function main(argv: string[], deps: { executor?: Executor; recompute?: typeof recomputeCareerWeights } = {}): Promise<number> {
  const i = argv.indexOf('--expect-db');
  const expectDb = i >= 0 ? argv[i + 1] : undefined;
  if (!expectDb) {
    console.error('usage: --expect-db <name> [--apply]');
    return 2;
  }
  const executor = deps.executor ?? db;
  try {
    await assertExpectedDb(expectDb, executor);
  } catch (err) {
    console.error(formatDbError(err));
    return 1;
  }
  const apply = argv.includes('--apply');
  const run = deps.recompute ?? recomputeCareerWeights;
  try {
    const report = await db.transaction(tx => run(tx as Executor, { apply }));
    console.log(`${apply ? 'APPLY' : 'DRY RUN'} expect-db: ${expectDb}\n${formatReport(report)}${apply ? '' : '\nDRY RUN — nothing written.'}`);
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
