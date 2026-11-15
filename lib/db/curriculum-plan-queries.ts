/**
 * Curriculum plan reads and writes (migration 0067). A plan is one JSON
 * document; nothing here touches courses, snapshots or coverage.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { curriculumPlans } from '@/lib/db/schema';
import type { PlanState } from '@/lib/builder/types';
import type { OwnerKind } from '@/lib/what-if/types';

export type PlanRow = typeof curriculumPlans.$inferSelect;
export type PlanSummary = Pick<PlanRow, 'id' | 'name' | 'createdBy' | 'updatedBy' | 'updatedAt' | 'ownerGrantId' | 'ownerKind'> & { courses: number };

export async function createPlan(input: {
  name: string; state: PlanState; ownerGrantId: string; ownerKind: OwnerKind; createdBy: string;
}): Promise<PlanRow> {
  const [row] = await db.insert(curriculumPlans).values({ ...input, updatedBy: input.createdBy }).returning();
  return row!;
}

export async function getPlan(id: string): Promise<PlanRow | null> {
  const [row] = await db.select().from(curriculumPlans).where(eq(curriculumPlans.id, id));
  return row ?? null;
}

export async function listPlans(): Promise<PlanSummary[]> {
  return db.select({
    id: curriculumPlans.id, name: curriculumPlans.name, createdBy: curriculumPlans.createdBy,
    updatedBy: curriculumPlans.updatedBy, updatedAt: curriculumPlans.updatedAt,
    ownerGrantId: curriculumPlans.ownerGrantId, ownerKind: curriculumPlans.ownerKind,
    courses: sql<number>`jsonb_array_length(${curriculumPlans.state} -> 'placements')`,
  }).from(curriculumPlans).orderBy(desc(curriculumPlans.updatedAt));
}

/**
 * Save over `expectedVersion`. Returns the new row, or null when the plan has
 * moved on (someone else saved first) or no longer exists: the caller reloads
 * rather than overwriting the other person's work.
 */
export async function savePlan(
  id: string, expectedVersion: number, patch: { name: string; state: PlanState; updatedBy: string },
): Promise<PlanRow | null> {
  const [row] = await db.update(curriculumPlans)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(curriculumPlans.id, id), eq(curriculumPlans.version, expectedVersion)))
    .returning();
  return row ?? null;
}

export async function deletePlan(id: string): Promise<void> {
  await db.delete(curriculumPlans).where(eq(curriculumPlans.id, id));
}
