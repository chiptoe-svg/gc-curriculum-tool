/**
 * Course cluster reads and writes (migration 0070). A cluster is one JSON
 * document; nothing here touches courses, snapshots or coverage.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { curriculumClusters } from '@/lib/db/schema';
import type { ClusterState } from '@/lib/builder/cluster/state';
import type { OwnerKind } from '@/lib/what-if/types';

export type ClusterRow = typeof curriculumClusters.$inferSelect;
export type ClusterSummary = Pick<ClusterRow, 'id' | 'name' | 'createdBy' | 'updatedBy' | 'updatedAt' | 'ownerGrantId' | 'ownerKind'> & { courses: number };

export async function createCluster(input: {
  name: string; state: ClusterState; ownerGrantId: string; ownerKind: OwnerKind; createdBy: string;
}): Promise<ClusterRow> {
  const [row] = await db.insert(curriculumClusters).values({ ...input, updatedBy: input.createdBy }).returning();
  return row!;
}

export async function getCluster(id: string): Promise<ClusterRow | null> {
  const [row] = await db.select().from(curriculumClusters).where(eq(curriculumClusters.id, id));
  return row ?? null;
}

export async function listClusters(): Promise<ClusterSummary[]> {
  return db.select({
    id: curriculumClusters.id, name: curriculumClusters.name, createdBy: curriculumClusters.createdBy,
    updatedBy: curriculumClusters.updatedBy, updatedAt: curriculumClusters.updatedAt,
    ownerGrantId: curriculumClusters.ownerGrantId, ownerKind: curriculumClusters.ownerKind,
    courses: sql<number>`jsonb_array_length(${curriculumClusters.state} -> 'cards')`,
  }).from(curriculumClusters).orderBy(desc(curriculumClusters.updatedAt));
}

/**
 * Save over `expectedVersion`. Returns the new row, or null when the cluster has
 * moved on (someone else saved first) or no longer exists: the caller reloads
 * rather than overwriting the other person's work.
 */
export async function saveCluster(
  id: string, expectedVersion: number, patch: { name: string; state: ClusterState; updatedBy: string },
): Promise<ClusterRow | null> {
  const [row] = await db.update(curriculumClusters)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(eq(curriculumClusters.id, id), eq(curriculumClusters.version, expectedVersion)))
    .returning();
  return row ?? null;
}

export async function deleteCluster(id: string): Promise<void> {
  await db.delete(curriculumClusters).where(eq(curriculumClusters.id, id));
}
