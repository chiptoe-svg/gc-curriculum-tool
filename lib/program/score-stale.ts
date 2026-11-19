/**
 * Score every stale snapshot: one coverage-scoring call per snapshot, carrying only that
 * snapshot's missing competency ids. Shared by the /program "Score N stale snapshots" button
 * (app/api/program/coverage/refresh/route.ts) and scripts/program/score-stale.ts.
 * Writes coverage cells and records spend; does NOT touch the wiki (callers decide).
 * Checks the daily cost cap before every call and stops when it trips.
 */
import { db } from '@/lib/db/client';
import { subCompetencies } from '@/lib/db/schema';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { listStaleSnapshots, upsertCoverageCell } from '@/lib/db/program-coverage-queries';
import { scoreSnapshotCompetencies } from '@/lib/ai/analyze/program-score-coverage';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';

export interface StaleScoreResult {
  snapshotId: string;
  courseCode: string;
  status: 'ok' | 'failed';
  cellCount?: number;
  /** Competency ids scored in this call (the snapshot's previously missing ids). */
  competencyIds?: string[];
  errorReason?: string;
}

export async function scoreStaleSnapshots(): Promise<{ results: StaleScoreResult[]; stoppedAtCap: boolean }> {
  const stale = await listStaleSnapshots();

  // Order the calls by courseCode (deterministic).
  stale.sort((a, b) => a.courseCode.localeCompare(b.courseCode));

  // Pre-fetch the full catalog once — every stale snapshot's missing ids
  // are a subset of it.
  const catalog = await db.select().from(subCompetencies);
  const catalogById = new Map(catalog.map(c => [c.id, c]));

  const results: StaleScoreResult[] = [];

  // One scoring call per stale snapshot. Re-check the daily cost cap before
  // each call and stop early when it trips, so a large catalog can't run an
  // unbounded paid batch.
  let stoppedAtCap = false;
  for (const snapToScore of stale) {
    const cap = await checkDailyCap();
    if (!cap.ok) { stoppedAtCap = true; break; }

    const snap = await getSnapshotById(snapToScore.snapshotId);
    if (!snap) {
      results.push({ snapshotId: snapToScore.snapshotId, courseCode: snapToScore.courseCode, status: 'failed', errorReason: 'snapshot not found' });
      continue;
    }

    const competencies = snapToScore.missingCompetencyIds
      .map(id => catalogById.get(id))
      .filter((c): c is typeof catalog[number] => !!c)
      .map(c => ({
        id: c.id,
        name: c.name,
        knowDescriptor: c.knowDescriptor,
        understandDescriptor: c.understandDescriptor,
        doDescriptor: c.doDescriptor,
        foundational: c.foundational,
        scoring: c.scoring,
      }));
    if (competencies.length === 0) {
      results.push({ snapshotId: snapToScore.snapshotId, courseCode: snapToScore.courseCode, status: 'failed', errorReason: 'no competencies to score' });
      continue;
    }

    try {
      const { result, model, costUsdCents, rejectedCompetencyIds } = await scoreSnapshotCompetencies({
        snapshotId: snapToScore.snapshotId,
        courseCode: snapToScore.courseCode,
        snapshotProfile: snap.profile,
        competencies,
      });

      for (const cell of result.cells) {
        await upsertCoverageCell({
          snapshotId: snapToScore.snapshotId,
          subCompetencyId: cell.competency_id,
          kDepth: cell.k_depth,
          uDepth: cell.u_depth,
          dDepth: cell.d_depth,
          matchedCompetency: cell.matched_competency,
          evidenceExcerpt: cell.evidence_excerpt,
          confidence: cell.confidence,
          rationale: cell.rationale,
          model,
        });
      }
      await recordSpend(costUsdCents);
      for (const id of rejectedCompetencyIds ?? []) {
        console.warn(`[coverage] ${snapToScore.snapshotId} ${id}: foundational cell had K/U depths — dropped, will re-score`);
      }
      results.push({ snapshotId: snapToScore.snapshotId, courseCode: snapToScore.courseCode, status: 'ok', cellCount: result.cells.length, competencyIds: result.cells.map(c => c.competency_id) });
    } catch (e) {
      results.push({
        snapshotId: snapToScore.snapshotId,
        courseCode: snapToScore.courseCode,
        status: 'failed',
        errorReason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { results, stoppedAtCap };
}
