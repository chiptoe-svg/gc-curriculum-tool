import { NextResponse } from 'next/server';
import { isValidSlug } from '@/lib/slug';
import { loadScaffoldingTarget } from '@/lib/db/scaffolding-queries';
import { aggregateSubCompetency } from '@/lib/program/scaffolding';
import { checkIpRateLimit } from '@/lib/rate-limit/ip-rate-limit';
import { hashIp } from '@/lib/ip-hash';

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!isValidSlug(slug)) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });

  const { allowed } = await checkIpRateLimit(hashIp(req));
  if (!allowed) return NextResponse.json({ error: 'rate limit exceeded' }, { status: 429 });

  const targetId = url.searchParams.get('target') ?? '';
  if (!targetId) return NextResponse.json({ error: 'missing target' }, { status: 400 });

  const input = await loadScaffoldingTarget(targetId);
  if (!input) return NextResponse.json({ error: 'target not found' }, { status: 404 });

  const rows = input.subCompetencies.map(sub => {
    const cells = input.cellsBySubCompetency.get(sub.id) ?? [];
    const agg = aggregateSubCompetency(sub.id, sub.name, cells);
    return {
      subCompetency: sub,
      cells: cells.map(c => ({
        snapshotId: c.snapshotId,
        courseCode: c.courseCode,
        sequenceIndex: c.sequenceIndex,
        kDepth: c.kDepth,
        uDepth: c.uDepth,
        dDepth: c.dDepth,
        pfConditions: c.productiveFailureConditions,
      })),
      scaffoldingStatus: agg.scaffolding.status,
      phases: agg.scaffolding.phases,
      cumulativePfScore: Number(agg.cumulativePfScore.toFixed(3)),
      pfStatus: agg.pfStatus,
    };
  });

  return NextResponse.json({
    target: { id: input.targetId, name: input.targetName },
    courses: input.courses,
    rows,
  });
}
