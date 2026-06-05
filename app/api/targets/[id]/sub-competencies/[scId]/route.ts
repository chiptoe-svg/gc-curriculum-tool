import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { subCompetencies, prototypeTargetEdits } from '@/lib/db/schema';
import { clearTargetCache } from '@/lib/db/career-targets-queries';
import { invalidateCoverageForSubCompetency } from '@/lib/db/program-coverage-queries';
import { hashIp } from '@/lib/ip-hash';
import { eq, and } from 'drizzle-orm';

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  knowDescriptor: z.string().min(1).optional(),
  understandDescriptor: z.string().min(1).optional(),
  doDescriptor: z.string().min(1).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; scId: string }> }
): Promise<Response> {
  const { id, scId } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    // Get current state for audit log
    const [current] = await db
      .select()
      .from(subCompetencies)
      .where(and(eq(subCompetencies.id, scId), eq(subCompetencies.careerTargetId, id)))
      .limit(1);

    if (!current) {
      return NextResponse.json({ error: `sub-competency not found: ${scId}` }, { status: 404 });
    }

    const updates: Partial<typeof subCompetencies.$inferInsert> = { updatedAt: new Date() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.knowDescriptor !== undefined) updates.knowDescriptor = parsed.data.knowDescriptor;
    if (parsed.data.understandDescriptor !== undefined) updates.understandDescriptor = parsed.data.understandDescriptor;
    if (parsed.data.doDescriptor !== undefined) updates.doDescriptor = parsed.data.doDescriptor;

    const [updated] = await db
      .update(subCompetencies)
      .set(updates)
      .where(and(eq(subCompetencies.id, scId), eq(subCompetencies.careerTargetId, id)))
      .returning();

    // Audit log
    const ipHash = hashIp(req);
    await db.insert(prototypeTargetEdits).values({
      ipHash,
      entityType: 'sub_competency',
      entityId: scId,
      changeType: 'update',
      before: current as unknown as Record<string, unknown>,
      after: parsed.data as Record<string, unknown>,
    });

    await invalidateCoverageForSubCompetency(id, scId);
    clearTargetCache();
    return NextResponse.json(updated);
  } catch (err) {
    console.error(`PATCH /api/targets/${id}/sub-competencies/${scId} failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
