import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { getTargetById, clearTargetCache } from '@/lib/db/career-targets-queries';
import { prototypeTargetEdits } from '@/lib/db/schema';
import { hashIp } from '@/lib/ip-hash';
import { eq } from 'drizzle-orm';

const patchSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  shortDefinition: z.string().min(1).max(1000).optional(),
  industryContexts: z.array(z.string().min(1)).optional(),
  knowDescriptors: z.array(z.string().min(1)).optional(),
  understandDescriptors: z.array(z.string().min(1)).optional(),
  doDescriptors: z.array(z.string().min(1)).optional(),
  defensibilityNote: z.string().min(1).optional(),
  socCode: z.string().nullable().optional(),
});

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const { id } = await params;
  try {
    const target = await getTargetById(id);
    if (!target) {
      return NextResponse.json({ error: `target not found: ${id}` }, { status: 404 });
    }
    return NextResponse.json(target);
  } catch (err) {
    console.error(`GET /api/targets/${id} failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}

export async function PATCH(
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

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const before = await getTargetById(id);
    if (!before) {
      return NextResponse.json({ error: `target not found: ${id}` }, { status: 404 });
    }

    const updates: Partial<typeof careerTargets.$inferInsert> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.shortDefinition !== undefined) updates.shortDefinition = parsed.data.shortDefinition;
    if (parsed.data.industryContexts !== undefined) updates.industryContexts = parsed.data.industryContexts;
    if (parsed.data.knowDescriptors !== undefined) updates.knowDescriptors = parsed.data.knowDescriptors;
    if (parsed.data.understandDescriptors !== undefined) updates.understandDescriptors = parsed.data.understandDescriptors;
    if (parsed.data.doDescriptors !== undefined) updates.doDescriptors = parsed.data.doDescriptors;
    if (parsed.data.defensibilityNote !== undefined) updates.defensibilityNote = parsed.data.defensibilityNote;
    if ('socCode' in parsed.data) updates.socCode = parsed.data.socCode ?? undefined;
    updates.updatedAt = new Date();

    await db.update(careerTargets).set(updates).where(eq(careerTargets.id, id));

    // Audit log
    const ipHash = hashIp(req);
    await db.insert(prototypeTargetEdits).values({
      ipHash,
      entityType: 'career_target',
      entityId: id,
      changeType: 'update',
      before: before as unknown as Record<string, unknown>,
      after: parsed.data as Record<string, unknown>,
    });

    clearTargetCache();
    const updated = await getTargetById(id);
    return NextResponse.json(updated);
  } catch (err) {
    console.error(`PATCH /api/targets/${id} failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
