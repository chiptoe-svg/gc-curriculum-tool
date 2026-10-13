import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getMatrixData, listStaleSnapshots } from '@/lib/db/program-coverage-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

// GET /api/program/coverage?slug=...
// Returns the full matrix data: courses, targets, sub-competencies, cells,
// plus staleSnapshotCount (I-2, hostile-review fix wave) — the number of
// snapshots the bulk-refresh route would actually score (one AI call
// each), for the /program button label. Pre-computed; this is a pure read
// from target_coverage (view over snapshot_competency_coverage) plus the
// same listStaleSnapshots query the refresh route itself uses to decide
// what to score.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const data = await getMatrixData();
  const staleSnapshotCount = (await listStaleSnapshots()).length;
  return NextResponse.json({ ...data, staleSnapshotCount });
}
