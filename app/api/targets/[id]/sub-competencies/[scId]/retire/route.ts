import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { prototypeTargetEdits } from '@/lib/db/schema';
import { clearTargetCache } from '@/lib/db/career-targets-queries';
import { getTargetCompetency, retireCompetencyFromTarget } from '@/lib/db/competency-catalog-queries';
import { hashIp } from '@/lib/ip-hash';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; scId: string }> }
): Promise<Response> {
  const { id, scId } = await params;

  try {
    const current = await getTargetCompetency(id, scId);

    if (!current) {
      return NextResponse.json({ error: `sub-competency not found: ${scId}` }, { status: 404 });
    }

    if (current.retired) {
      return NextResponse.json({ error: 'sub-competency is already retired' }, { status: 409 });
    }

    // P0b Amendment 1 (A1): shared-aware retire — removes only this target's
    // claim; the catalog row is left ACTIVE and UNLINKED (never auto-retired)
    // when no other target still uses it.
    const result = await db.transaction((tx) => retireCompetencyFromTarget(tx, id, scId));

    // Audit log
    const ipHash = hashIp(req);
    await db.insert(prototypeTargetEdits).values({
      ipHash,
      entityType: 'sub_competency',
      entityId: scId,
      changeType: 'retire',
      before: current as unknown as Record<string, unknown>,
      after: null,
    });

    clearTargetCache();
    return NextResponse.json({ ok: true, result, competencyId: scId });
  } catch (err) {
    console.error(`POST /api/targets/${id}/sub-competencies/${scId}/retire failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
