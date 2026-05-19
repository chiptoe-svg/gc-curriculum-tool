import { NextResponse } from 'next/server';
import { db } from '@/lib/db/client';
import { careerTargets } from '@/lib/db/schema';
import { asc } from 'drizzle-orm';
import { resolvePartner } from '@/lib/partners/auth';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const partner = await resolvePartner(req, url.searchParams.get('token'));
  if (!partner) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const targets = await db.select({
    id: careerTargets.id,
    name: careerTargets.name,
    shortDefinition: careerTargets.shortDefinition,
    industryContexts: careerTargets.industryContexts,
  }).from(careerTargets).orderBy(asc(careerTargets.displayOrder));

  return NextResponse.json({ targets });
}
