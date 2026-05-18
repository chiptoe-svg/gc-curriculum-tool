import { db } from './client';
import { careerTargets, subCompetencies } from './schema';
import { eq, asc } from 'drizzle-orm';
import type { CareerTarget } from '@/lib/domain/types';

// In-memory cache for the duration of a single serverless invocation. The
// analyze route makes up to 6 calls each needing the target; we don't want
// to re-query Neon every time.
let invocationCache: Map<string, CareerTarget> | null = null;

export function clearTargetCache() {
  invocationCache = null;
}

export async function listTargets(): Promise<CareerTarget[]> {
  const ts = await db.select().from(careerTargets).orderBy(asc(careerTargets.displayOrder));
  const sc = await db
    .select()
    .from(subCompetencies)
    .where(eq(subCompetencies.retired, false))
    .orderBy(asc(subCompetencies.displayOrder));

  return ts.map((t) => ({
    id: t.id,
    name: t.name,
    shortDefinition: t.shortDefinition,
    industryContexts: t.industryContexts,
    knowDescriptors: t.knowDescriptors,
    understandDescriptors: t.understandDescriptors,
    doDescriptors: t.doDescriptors,
    defensibilityNote: t.defensibilityNote,
    socCode: t.socCode ?? null,
    subCompetencies: sc
      .filter((s) => s.careerTargetId === t.id)
      .map((s) => ({
        id: s.id,
        name: s.name,
        knowDescriptor: s.knowDescriptor,
        understandDescriptor: s.understandDescriptor,
        doDescriptor: s.doDescriptor,
      })),
  }));
}

export async function getTargetById(id: string): Promise<CareerTarget | null> {
  if (invocationCache?.has(id)) return invocationCache.get(id)!;
  const targets = await listTargets();
  invocationCache = new Map(targets.map((t) => [t.id, t]));
  return invocationCache.get(id) ?? null;
}
