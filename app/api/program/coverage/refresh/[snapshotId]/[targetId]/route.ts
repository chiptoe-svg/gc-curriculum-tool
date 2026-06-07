import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { db } from '@/lib/db/client';
import { eq } from 'drizzle-orm';
import { careerTargets, subCompetencies } from '@/lib/db/schema';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { upsertCoverageCell } from '@/lib/db/program-coverage-queries';
import { scoreSnapshotAgainstTarget } from '@/lib/ai/analyze/program-score-coverage';
import { regenerateWikiInBackground } from '@/lib/ai/wiki/update';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { checkDailyCap, recordSpend } from '@/lib/rate-limit/daily-cap';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 60;

interface RouteContext { params: Promise<{ snapshotId: string; targetId: string }> }

// POST /api/program/coverage/refresh/[snapshotId]/[targetId]?slug=...
// Score a single (snapshot, target) pair on demand. Used by the matrix UI
// to fill in missing cells, or to re-score a specific pair when descriptors
// change.
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

  const subs = await db.select().from(subCompetencies).where(eq(subCompetencies.careerTargetId, targetId));

  // Gate the paid scoring call on the daily cost cap.
  const cap = await checkDailyCap();
  if (!cap.ok) return NextResponse.json({ error: 'daily cost cap reached' }, { status: 429 });

  try {
    const { result, model, costUsdCents } = await scoreSnapshotAgainstTarget({
      snapshotId,
      courseCode: snapshot.courseCode,
      snapshotProfile: snapshot.profile,
      careerTarget: {
        id: target.id,
        name: target.name,
        shortDefinition: target.shortDefinition,
        knowDescriptors: target.knowDescriptors as string[],
        understandDescriptors: target.understandDescriptors as string[],
        doDescriptors: target.doDescriptors as string[],
      },
      subCompetencies: subs
        .filter(s => !s.retired)
        .map(s => ({
          id: s.id,
          name: s.name,
          knowDescriptor: s.knowDescriptor,
          understandDescriptor: s.understandDescriptor,
          doDescriptor: s.doDescriptor,
          displayOrder: s.displayOrder,
        })),
    });

    for (const cell of result.cells) {
      await upsertCoverageCell({
        snapshotId,
        careerTargetId: targetId,
        subCompetencyId: cell.sub_competency_id,
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
    // competency/target pages generate (they derive from snapshot_target_coverage).
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
