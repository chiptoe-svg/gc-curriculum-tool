import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { db } from '@/lib/db/client';
import { eq } from 'drizzle-orm';
import { careerTargets, subCompetencies } from '@/lib/db/schema';
import { getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { listStalePairs, upsertCoverageCell } from '@/lib/db/program-coverage-queries';
import { scoreSnapshotAgainstTarget } from '@/lib/ai/analyze/program-score-coverage';
import { regenerateWikiInBackground } from '@/lib/ai/wiki/update';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

export const maxDuration = 300;

// POST /api/program/coverage/refresh?slug=...
// Body: { force?: boolean }
// Scores every stale (latest-snapshot, target) pair. With force=true,
// re-scores every pair regardless of existing rows.
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const stale = await listStalePairs();
  // When force=true, we'd re-score everything — for v1, "force" is a future
  // enhancement; default behavior is "only fill in the missing cells."
  // To re-score a specific pair, the per-pair endpoint at
  // /api/program/coverage/refresh/[snapshotId]/[targetId] is the way.

  // Pre-fetch target context + sub-competencies for each unique target
  // ID — the scoring helper needs them per call.
  const uniqueTargetIds = Array.from(new Set(stale.map(p => p.careerTargetId)));
  const targetCache = new Map<string, { target: typeof careerTargets.$inferSelect; subs: Array<typeof subCompetencies.$inferSelect> }>();
  for (const tid of uniqueTargetIds) {
    const [t] = await db.select().from(careerTargets).where(eq(careerTargets.id, tid)).limit(1);
    const subs = await db.select().from(subCompetencies).where(eq(subCompetencies.careerTargetId, tid));
    if (t) targetCache.set(tid, { target: t, subs });
  }

  const results: Array<{
    snapshotId: string;
    courseCode: string;
    careerTargetId: string;
    status: 'ok' | 'failed';
    cellCount?: number;
    errorReason?: string;
  }> = [];

  // Order calls by target so that the per-target context can be prompt-cached
  // by OpenAI (see spec for cost rationale). Same target's calls are
  // contiguous, which keeps the cache window aligned.
  stale.sort((a, b) =>
    a.careerTargetId === b.careerTargetId
      ? a.courseCode.localeCompare(b.courseCode)
      : a.careerTargetId.localeCompare(b.careerTargetId)
  );

  for (const pair of stale) {
    const snap = await getSnapshotById(pair.snapshotId);
    if (!snap) {
      results.push({ ...pair, status: 'failed', errorReason: 'snapshot not found' });
      continue;
    }
    const targetCtx = targetCache.get(pair.careerTargetId);
    if (!targetCtx) {
      results.push({ ...pair, status: 'failed', errorReason: 'target context not loaded' });
      continue;
    }
    try {
      const { result, model } = await scoreSnapshotAgainstTarget({
        snapshotId: pair.snapshotId,
        courseCode: pair.courseCode,
        snapshotProfile: snap.profile,
        careerTarget: {
          id: targetCtx.target.id,
          name: targetCtx.target.name,
          shortDefinition: targetCtx.target.shortDefinition,
          knowDescriptors: targetCtx.target.knowDescriptors as string[],
          understandDescriptors: targetCtx.target.understandDescriptors as string[],
          doDescriptors: targetCtx.target.doDescriptors as string[],
        },
        subCompetencies: targetCtx.subs
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

      // Upsert every cell from the response.
      for (const cell of result.cells) {
        await upsertCoverageCell({
          snapshotId: pair.snapshotId,
          careerTargetId: pair.careerTargetId,
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
      results.push({ ...pair, status: 'ok', cellCount: result.cells.length });
    } catch (e) {
      results.push({
        ...pair,
        status: 'failed',
        errorReason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const okCount = results.filter(r => r.status === 'ok').length;
  const failedCount = results.length - okCount;

  // Re-fire wiki-update for each DISTINCT snapshot that just got fresh coverage.
  // The competency/target wiki pages derive from snapshot_target_coverage, so
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
    pairs: results,
  });
}
