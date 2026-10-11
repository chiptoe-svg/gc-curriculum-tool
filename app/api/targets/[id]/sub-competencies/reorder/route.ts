import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { prototypeTargetEdits } from '@/lib/db/schema';
import { getTargetById, clearTargetCache } from '@/lib/db/career-targets-queries';
import { setCompetencyOrderInTarget } from '@/lib/db/competency-catalog-queries';
import { hashIp } from '@/lib/ip-hash';

const reorderSchema = z.object({
  order: z.array(z.string().min(1)),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = reorderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const target = await getTargetById(id);
    if (!target) {
      return NextResponse.json({ error: `target not found: ${id}` }, { status: 404 });
    }

    const { order } = parsed.data;

    // Update each competency's position in this target; ids that are not
    // members of the target are ignored (as before).
    await db.transaction(async (tx) => {
      for (let i = 0; i < order.length; i++) {
        await setCompetencyOrderInTarget(tx, id, order[i]!, i);
      }
    });

    // Single audit log entry for the reorder
    const ipHash = hashIp(req);
    await db.insert(prototypeTargetEdits).values({
      ipHash,
      entityType: 'sub_competency',
      entityId: id,
      changeType: 'reorder',
      before: null,
      after: { order } as Record<string, unknown>,
    });

    clearTargetCache();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`POST /api/targets/${id}/sub-competencies/reorder failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
