import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { refreshWikiAfterScoringInBackground } from '@/lib/program/refresh-after-scoring';
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

  // Rebuild only what the new scores changed (owner, 2026-11-19): the scored competencies' pages,
  // the targets that list them, the index, and course pages whose latest snapshot came out above
  // zero. One background pass; it used to be a full per-snapshot rebuild for every scored snapshot
  // (~52 program pages each). Fire-and-forget: never fails the scoring response.
  refreshWikiAfterScoringInBackground(results);

  return NextResponse.json({
    scored: okCount,
    failed: failedCount,
    stoppedAtCap,
    snapshots: results,
  });
}
