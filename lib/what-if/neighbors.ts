import { getLatestSnapshotByCourse, getSnapshotById } from '@/lib/db/capture-snapshots-queries';
import { listConfirmedEdgePairs } from '@/lib/db/prerequisite-edge-queries';
import {
  assembleNeighborContext,
  snapshotToNeighborProfile,
  type NeighborContext,
  type NeighborProfile,
} from '@/lib/what-if/neighbor-helpers';

/**
 * The course's neighbors as they are now, with the focal course taken from the
 * what-if's base snapshot (not the latest one). Reads only.
 */
export async function loadWhatIfNeighborContext(
  courseCode: string,
  baseSnapshotId: string,
): Promise<NeighborContext> {
  const base = await getSnapshotById(baseSnapshotId);
  if (!base) throw new Error(`loadWhatIfNeighborContext: base snapshot ${baseSnapshotId} not found`);

  const edgePairs = (await listConfirmedEdgePairs()).map(p => ({
    relyingCourseCode: p.focal,
    prereqCourseCode: p.prereq,
  }));
  const neighborCodes = new Set<string>();
  for (const e of edgePairs) {
    if (e.relyingCourseCode === courseCode) neighborCodes.add(e.prereqCourseCode);
    if (e.prereqCourseCode === courseCode) neighborCodes.add(e.relyingCourseCode);
  }
  neighborCodes.delete(courseCode);

  const profiles: Record<string, NeighborProfile> = {
    [courseCode]: snapshotToNeighborProfile(courseCode, base.profile),
  };
  await Promise.all([...neighborCodes].map(async code => {
    const snap = await getLatestSnapshotByCourse(code);
    if (snap) profiles[code] = snapshotToNeighborProfile(code, snap.profile);
  }));

  return assembleNeighborContext({ focalCourseCode: courseCode, profiles, edgePairs });
}
