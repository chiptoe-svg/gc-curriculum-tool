import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseObjectiveGuides, courseCaptureSnapshots } from '@/lib/db/schema';
import type { ObjectiveGuide } from '@/lib/objective-guide/schema';

export interface StoredObjectiveGuide {
  courseCode: string;
  snapshotId: string;
  guide: ObjectiveGuide;
  droppedNames: string[];
  model: string;
  generatedAt: Date;
  /** When the capture the guide was built from was taken; null if that snapshot is gone. */
  snapshotCreatedAt: Date | null;
}

export async function upsertObjectiveGuide(input: {
  courseCode: string;
  snapshotId: string;
  guide: ObjectiveGuide;
  droppedNames: string[];
  model: string;
}): Promise<void> {
  const generatedAt = new Date();
  await db
    .insert(courseObjectiveGuides)
    .values({ ...input, generatedAt })
    .onConflictDoUpdate({
      target: courseObjectiveGuides.courseCode,
      set: {
        snapshotId: input.snapshotId,
        guide: input.guide,
        droppedNames: input.droppedNames,
        model: input.model,
        generatedAt,
      },
    });
}

export async function getObjectiveGuide(courseCode: string): Promise<StoredObjectiveGuide | null> {
  const rows = await db
    .select({
      courseCode: courseObjectiveGuides.courseCode,
      snapshotId: courseObjectiveGuides.snapshotId,
      guide: courseObjectiveGuides.guide,
      droppedNames: courseObjectiveGuides.droppedNames,
      model: courseObjectiveGuides.model,
      generatedAt: courseObjectiveGuides.generatedAt,
      snapshotCreatedAt: courseCaptureSnapshots.createdAt,
    })
    .from(courseObjectiveGuides)
    .leftJoin(courseCaptureSnapshots, eq(courseCaptureSnapshots.id, courseObjectiveGuides.snapshotId))
    .where(eq(courseObjectiveGuides.courseCode, courseCode))
    .limit(1);
  return rows[0] ?? null;
}
