// app/api/admin/synthesis/targets/[targetId]/regenerate-aggregate/route.ts
import { NextResponse } from 'next/server';
import { checkAdminAuth } from '@/lib/auth/admin-auth';
import { regenerateAggregate } from '@/lib/ai/position-capture/aggregate';
import { regenerateTargetDemand } from '@/lib/ai/position-capture/demand-rollup';

interface RouteContext { params: Promise<{ targetId: string }> }

export async function POST(req: Request, { params }: RouteContext): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.searchParams.get('slug') ?? '';
  if (!checkAdminAuth(req, { slug })) return NextResponse.json({ error: 'invalid slug' }, { status: 401 });
  const { targetId } = await params;

  try {
    const result = await regenerateAggregate(targetId);
    // Demand→coverage seam: recompute the numeric weighted demand alongside the
    // markdown aggregate. Gated — career_target_demand's migration is unapplied,
    // so this only runs once the seam is activated.
    if (process.env.DEMAND_COVERAGE_SEAM === '1') {
      await regenerateTargetDemand(targetId);
    }
    return NextResponse.json({ ok: true, positionIds: result.positionIds, markdown: result.markdown });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'regenerate failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
