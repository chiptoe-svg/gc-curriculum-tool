import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { subCompetencies, prototypeTargetEdits } from '@/lib/db/schema';
import { clearTargetCache } from '@/lib/db/career-targets-queries';
import { hashIp } from '@/lib/ip-hash';
import { eq, and } from 'drizzle-orm';

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; scId: string }> }
): Promise<Response> {
  const { id, scId } = await params;

  try {
    const [current] = await db
      .select()
      .from(subCompetencies)
      .where(and(eq(subCompetencies.id, scId), eq(subCompetencies.careerTargetId, id)))
      .limit(1);

    if (!current) {
      return NextResponse.json({ error: `sub-competency not found: ${scId}` }, { status: 404 });
    }

    if (current.retired) {
      return NextResponse.json({ error: 'sub-competency is already retired' }, { status: 409 });
    }

    await db
      .update(subCompetencies)
      .set({ retired: true, updatedAt: new Date() })
      .where(and(eq(subCompetencies.id, scId), eq(subCompetencies.careerTargetId, id)));

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
    return NextResponse.json({ ok: true, retired: scId });
  } catch (err) {
    console.error(`POST /api/targets/${id}/sub-competencies/${scId}/retire failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
