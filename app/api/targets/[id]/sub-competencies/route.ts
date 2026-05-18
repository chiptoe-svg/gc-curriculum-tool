import { NextResponse } from 'next/server';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { subCompetencies, prototypeTargetEdits } from '@/lib/db/schema';
import { getTargetById, clearTargetCache } from '@/lib/db/career-targets-queries';
import { hashIp } from '@/lib/ip-hash';
import { eq, and, asc } from 'drizzle-orm';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  knowDescriptor: z.string().min(1),
  understandDescriptor: z.string().min(1),
  doDescriptor: z.string().min(1),
});

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    // Verify target exists
    const target = await getTargetById(id);
    if (!target) {
      return NextResponse.json({ error: `target not found: ${id}` }, { status: 404 });
    }

    // Generate unique slug ID
    const baseSlug = slugify(parsed.data.name);
    let candidateId = baseSlug;
    let suffix = 2;
    while (true) {
      const existing = await db
        .select({ id: subCompetencies.id })
        .from(subCompetencies)
        .where(eq(subCompetencies.id, candidateId))
        .limit(1);
      if (existing.length === 0) break;
      candidateId = `${baseSlug}-${suffix}`;
      suffix++;
    }

    // Get next display_order
    const existing = await db
      .select({ displayOrder: subCompetencies.displayOrder })
      .from(subCompetencies)
      .where(and(eq(subCompetencies.careerTargetId, id), eq(subCompetencies.retired, false)))
      .orderBy(asc(subCompetencies.displayOrder));
    const nextOrder = existing.length > 0
      ? (existing[existing.length - 1]!.displayOrder + 1)
      : 0;

    const [created] = await db.insert(subCompetencies).values({
      id: candidateId,
      careerTargetId: id,
      name: parsed.data.name,
      knowDescriptor: parsed.data.knowDescriptor,
      understandDescriptor: parsed.data.understandDescriptor,
      doDescriptor: parsed.data.doDescriptor,
      displayOrder: nextOrder,
      retired: false,
    }).returning();

    // Audit log
    const ipHash = hashIp(req);
    await db.insert(prototypeTargetEdits).values({
      ipHash,
      entityType: 'sub_competency',
      entityId: candidateId,
      changeType: 'create',
      before: null,
      after: parsed.data as Record<string, unknown>,
    });

    clearTargetCache();
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error(`POST /api/targets/${id}/sub-competencies failed`, err);
    return NextResponse.json({ error: 'internal server error' }, { status: 500 });
  }
}
