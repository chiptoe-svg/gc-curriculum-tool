/**
 * A throwaway competency for P0a write tests, so a test never deletes or
 * rewrites cloned rows the characterization golden depends on. Deleting it
 * cascades to its requirement and coverage rows.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { careerTargetRequirements, subCompetencies } from '@/lib/db/schema';

export const FIXTURE_COMPETENCY = 'zz-p0a-fixture-competency';

export async function addFixtureCompetency(targetId: string): Promise<void> {
  await db.insert(subCompetencies).values({
    id: FIXTURE_COMPETENCY,
    careerTargetId: targetId,
    name: 'ZZ P0a fixture',
    knowDescriptor: 'k',
    understandDescriptor: 'u',
    doDescriptor: 'd',
    displayOrder: 999,
    retired: false,
  }).onConflictDoNothing();
  await db.insert(careerTargetRequirements).values({
    careerTargetId: targetId,
    competencyId: FIXTURE_COMPETENCY,
    horizon: 'entry',
    weight: null,
    weightSource: 'faculty',
    status: 'draft',
    displayOrder: 999,
  }).onConflictDoNothing();
}

export async function removeFixtureCompetency(): Promise<void> {
  await db.delete(subCompetencies).where(eq(subCompetencies.id, FIXTURE_COMPETENCY));
}
