import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { regenerateWikiInBackground } from '@/lib/ai/wiki/update';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { scoreStaleSnapshots } from '@/lib/program/score-stale';
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

  const { results, stoppedAtCap } = await scoreStaleSnapshots();

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
