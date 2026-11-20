/**
 * After the /program button scores stale snapshots, rebuild only the wiki pages the new scores
 * changed (owner, 2026-11-19): the scored competencies' pages, the target pages that list them,
 * the index, and the course pages whose latest snapshot came out above zero on them. One pass,
 * in place of the old per-snapshot rebuild (~52 program pages per scored snapshot).
 */
import { and, gt, inArray, or } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { snapshotCompetencyCoverage } from '@/lib/db/schema';
import { readTargetCompetencyList } from '@/lib/db/membership-queries';
import { planChangedRefresh, type RefreshResult } from '@/lib/ai/wiki/refresh-all';
import { runWikiRefresh } from '@/lib/ai/wiki/refresh-run';
import type { StaleScoreResult } from '@/lib/program/score-stale';

export async function refreshWikiAfterScoring(
  results: ReadonlyArray<StaleScoreResult>,
  opts: { dryRun?: boolean; log?: (line: string) => void } = {},
): Promise<RefreshResult | null> {
  const ok = results.filter(r => r.status === 'ok' && (r.competencyIds?.length ?? 0) > 0);
  const competencyIds = [...new Set(ok.flatMap(r => r.competencyIds ?? []))];
  if (competencyIds.length === 0) return null;

  const above = await db
    .selectDistinct({ snapshotId: snapshotCompetencyCoverage.snapshotId })
    .from(snapshotCompetencyCoverage)
    .where(and(
      inArray(snapshotCompetencyCoverage.snapshotId, ok.map(r => r.snapshotId)),
      inArray(snapshotCompetencyCoverage.competencyId, competencyIds),
      or(gt(snapshotCompetencyCoverage.dDepth, 0), gt(snapshotCompetencyCoverage.kDepth, 0), gt(snapshotCompetencyCoverage.uDepth, 0)),
    ));
  const listed = await readTargetCompetencyList(db);

  const { result } = await runWikiRefresh(
    inputs => planChangedRefresh(inputs, { competencyIds, courseSnapshotIds: above.map(a => a.snapshotId) }, listed),
    { dryRun: opts.dryRun ?? false, log: opts.log ?? (line => console.log(`[wiki after scoring] ${line}`)) },
  );
  return result;
}

/** Fire-and-forget for the route: never fails the scoring response. */
export function refreshWikiAfterScoringInBackground(results: ReadonlyArray<StaleScoreResult>): void {
  void refreshWikiAfterScoring(results).catch(err => {
    console.error('[wiki after scoring] failed:', err instanceof Error ? err.message : err);
  });
}
