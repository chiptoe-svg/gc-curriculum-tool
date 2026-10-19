import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { db } from '@/lib/db/client';
import { asc, eq } from 'drizzle-orm';
import { careerTargets, targetSubCompetencies } from '@/lib/db/schema';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { getScoringFlags, flagsFor } from '@/lib/db/scoring-flags';
import { upsertCoverageCell } from '@/lib/db/program-coverage-queries';
import { scoreSnapshotCompetencies } from '@/lib/ai/analyze/program-score-coverage';
import { regenerateWikiInBackground } from '@/lib/ai/wiki/update';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 60;

interface RouteContext { params: Promise<{ snapshotId: string; targetId: string }> }

// POST /api/program/coverage/refresh/[snapshotId]/[targetId]?slug=...
// Score one snapshot against one target's ACTIVE (non-retired) competency
// members — URL unchanged, but the scoring call itself carries no
// career-target context (P0b Task 5). Used by the matrix UI to fill in
// missing cells, or to re-score a pair when descriptors change.
export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const { snapshotId, targetId } = await params;

  const snapshot = await getSnapshotById(snapshotId);
  if (!snapshot) return NextResponse.json({ error: 'snapshot not found' }, { status: 404 });

  const [target] = await db.select().from(careerTargets).where(eq(careerTargets.id, targetId)).limit(1);
  if (!target) return NextResponse.json({ error: 'target not found' }, { status: 404 });

  const subs = await db.select().from(targetSubCompetencies).where(eq(targetSubCompetencies.careerTargetId, targetId))
    .orderBy(asc(targetSubCompetencies.displayOrder), asc(targetSubCompetencies.id));
  const activeSubs = subs.filter(s => !s.retired);
  const flags = await getScoringFlags(activeSubs.map(s => s.id));

  // Gate the paid scoring call on the daily cost cap.
  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  try {
    const { result, model, costUsdCents } = await scoreSnapshotCompetencies({
      snapshotId,
      courseCode: snapshot.courseCode,
      snapshotProfile: snapshot.profile,
      competencies: activeSubs.map(s => ({
        id: s.id,
        name: s.name,
        knowDescriptor: s.knowDescriptor,
        understandDescriptor: s.understandDescriptor,
        doDescriptor: s.doDescriptor,
        ...flagsFor(flags, s.id),
      })),
    });

    // Cells are already scoped to the input competencies (unknown ids are
    // dropped by the scorer), so every returned cell is a member of this
    // target's active set.
    for (const cell of result.cells) {
      await upsertCoverageCell({
        snapshotId,
        careerTargetId: targetId,
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

    // Re-fire wiki-update for this snapshot now that coverage exists — lets the
    // competency/target pages generate (they derive from snapshot_competency_coverage).
    // Fire-and-forget; only when cells were actually written.
    if (result.cells.length > 0) {
      regenerateWikiInBackground(snapshotId, 'wiki recompile after coverage scoring (single pair)');
    }

    return NextResponse.json({ cellCount: result.cells.length, model });
  } catch (e) {
    return NextResponse.json(
      { error: 'scoring failed', detail: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
