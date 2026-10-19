import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { db } from '@/lib/db/client';
import { subCompetencies } from '@/lib/db/schema';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { listStaleSnapshots, upsertCoverageCell } from '@/lib/db/program-coverage-queries';
import { scoreSnapshotCompetencies } from '@/lib/ai/analyze/program-score-coverage';
import { regenerateWikiInBackground } from '@/lib/ai/wiki/update';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 300;

// POST /api/program/coverage/refresh?slug=...
// Scores every stale snapshot — one scoring call per snapshot, carrying
// only that snapshot's missing competency ids (P0b Task 5: scoring moved
// per-competency, no career-target context).
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const stale = await listStaleSnapshots();

  // Order the calls by courseCode (deterministic).
  stale.sort((a, b) => a.courseCode.localeCompare(b.courseCode));

  // Pre-fetch the full catalog once — every stale snapshot's missing ids
  // are a subset of it.
  const catalog = await db.select().from(subCompetencies);
  const catalogById = new Map(catalog.map(c => [c.id, c]));

  const results: Array<{
    snapshotId: string;
    courseCode: string;
    status: 'ok' | 'failed';
    cellCount?: number;
    errorReason?: string;
  }> = [];

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
      const { result, model, costUsdCents } = await scoreSnapshotCompetencies({
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
      results.push({ snapshotId: snapToScore.snapshotId, courseCode: snapToScore.courseCode, status: 'ok', cellCount: result.cells.length });
    } catch (e) {
      results.push({
        snapshotId: snapToScore.snapshotId,
        courseCode: snapToScore.courseCode,
        status: 'failed',
        errorReason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const okCount = results.filter(r => r.status === 'ok').length;
  const failedCount = results.length - okCount;

  // Re-fire wiki-update for each DISTINCT snapshot that just got fresh coverage.
  // The competency/target wiki pages derive from snapshot_competency_coverage, so
  // they can't generate at snapshot-creation time (wiki-update fires before
  // scoring). Now that the cells exist, regenerate once per snapshot. Deduped,
  // fire-and-forget (non-blocking; never fails the scoring response).
  const scoredSnapshotIds = Array.from(new Set(
    results.filter(r => r.status === 'ok' && (r.cellCount ?? 0) > 0).map(r => r.snapshotId),
  ));
  for (const sid of scoredSnapshotIds) {
    regenerateWikiInBackground(sid, 'wiki recompile after coverage scoring');
  }

  return NextResponse.json({
    scored: okCount,
    failed: failedCount,
    stoppedAtCap,
    snapshots: results,
  });
}
