/**
 * A throwaway competency for P0a write tests, so a test never deletes or
 * rewrites cloned rows the characterization golden depends on. Deleting it
 * cascades to its requirement and coverage rows.
 */
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { subCompetencies } from '@/lib/db/schema';
import { insertCompetencyForTarget } from '@/lib/db/competency-catalog-queries';

export const FIXTURE_COMPETENCY = 'zz-p0a-fixture-competency';

export async function addFixtureCompetency(targetId: string): Promise<void> {
  const [existing] = await db.select({ id: subCompetencies.id }).from(subCompetencies).where(eq(subCompetencies.id, FIXTURE_COMPETENCY));
  if (existing) return;
  await db.transaction((tx) => insertCompetencyForTarget(tx, {
    id: FIXTURE_COMPETENCY,
    careerTargetId: targetId,
    name: 'ZZ P0a fixture',
    knowDescriptor: 'k',
    understandDescriptor: 'u',
    doDescriptor: 'd',
    displayOrder: 999,
  }));
}

export async function removeFixtureCompetency(): Promise<void> {
  await db.delete(subCompetencies).where(eq(subCompetencies.id, FIXTURE_COMPETENCY));
}
