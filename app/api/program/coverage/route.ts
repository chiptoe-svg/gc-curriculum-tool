import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { getMatrixData } from '@/lib/db/program-coverage-queries';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

// GET /api/program/coverage?slug=...
// Returns the full matrix data: courses, targets, sub-competencies, cells.
// Pre-computed; this is a pure read from snapshot_target_coverage.
export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const ipHash = hashIp(req);
  const { allowed } = await checkIpRateLimit(ipHash);
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const data = await getMatrixData();
  return NextResponse.json(data);
}
