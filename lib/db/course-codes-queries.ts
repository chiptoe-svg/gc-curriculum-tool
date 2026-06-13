import { asc, eq, inArray } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseCodes } from '@/lib/db/schema';

export type CourseCodeRow = typeof courseCodes.$inferSelect;
export type PairedRole = 'lecture' | 'lab' | 'other';

export interface AddPairedCodeInput {
  courseCode: string;          // the PRIMARY course
  pairedCode: string;
  role: PairedRole;
}

export async function addPairedCode(input: AddPairedCodeInput): Promise<CourseCodeRow> {
  const [row] = await db.insert(courseCodes).values(input).returning();
  if (!row) throw new Error('addPairedCode: no row returned');
  return row;
}

export async function listPairedCodes(courseCode: string): Promise<CourseCodeRow[]> {
  return db.select().from(courseCodes).where(eq(courseCodes.courseCode, courseCode)).orderBy(asc(courseCodes.createdAt));
}

/** All paired codes for a set of primaries (batched read for list views). */
export async function listPairedCodesForCourses(courseCodesList: string[]): Promise<CourseCodeRow[]> {
  if (courseCodesList.length === 0) return [];
  return db.select().from(courseCodes).where(inArray(courseCodes.courseCode, courseCodesList));
}

/** Record this paired page's Canvas import provenance (set by the canvas-import route). */
export async function setPairedCanvasProvenance(pairedCode: string, canvasCourseName: string | null, canvasImportedAt: Date): Promise<void> {
  await db.update(courseCodes)
    .set({ canvasCourseName, canvasImportedAt })
    .where(eq(courseCodes.pairedCode, pairedCode));
}
