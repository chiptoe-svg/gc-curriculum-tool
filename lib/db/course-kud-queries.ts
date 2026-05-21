import { eq, desc, sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseKuds, courseKudRuns } from '@/lib/db/schema';
import type { CourseKudResult } from '@/lib/domain/types';

export async function getCourseKud(courseCode: string) {
  const rows = await db.select().from(courseKuds).where(eq(courseKuds.courseCode, courseCode));
  return rows[0] ?? null;
}

export interface InsertKudRunInput {
  courseCode: string;
  result: CourseKudResult;
  profileSnapshot: { learningObjectives: string[]; majorProjects: string[]; skillsRequired: string[] };
  model: string;
  costUsdCents: number;
}

export async function insertKudRun(input: InsertKudRunInput): Promise<string> {
  const [row] = await db
    .insert(courseKudRuns)
    .values(input)
    .returning({ id: courseKudRuns.id });
  if (!row) throw new Error('insertKudRun: no row returned');
  return row.id;
}

export interface UpsertCourseKudInput {
  courseCode: string;
  thresholdConcept: string;
  know: string[];
  understand: string[];
  do: string[];
  sourceRunId: string;
}

export async function upsertCourseKud(input: UpsertCourseKudInput): Promise<void> {
  await db
    .insert(courseKuds)
    .values({
      courseCode: input.courseCode,
      thresholdConcept: input.thresholdConcept,
      know: input.know,
      understand: input.understand,
      do: input.do,
      sourceRunId: input.sourceRunId,
      manuallyEdited: false,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: courseKuds.courseCode,
      set: {
        thresholdConcept: sql`excluded.threshold_concept`,
        know: sql`excluded.know`,
        understand: sql`excluded.understand`,
        do: sql`excluded.do`,
        sourceRunId: sql`excluded.source_run_id`,
        manuallyEdited: false,
        approvedAt: null,
        approvedByIpHash: null,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

export async function saveKudDraft(input: {
  courseCode: string;
  thresholdConcept: string;
  know: string[];
  understand: string[];
  do: string[];
  manuallyEdited: boolean;
}): Promise<void> {
  await db
    .update(courseKuds)
    .set({
      thresholdConcept: input.thresholdConcept,
      know: input.know,
      understand: input.understand,
      do: input.do,
      manuallyEdited: input.manuallyEdited,
      updatedAt: new Date(),
    })
    .where(eq(courseKuds.courseCode, input.courseCode));
}

export async function acceptCourseKud(
  courseCode: string,
  approvedAt: Date,
  approvedByIpHash: string,
): Promise<void> {
  await db
    .update(courseKuds)
    .set({ approvedAt, approvedByIpHash, updatedAt: new Date() })
    .where(eq(courseKuds.courseCode, courseCode));
}

export async function resetKudApproval(courseCode: string): Promise<void> {
  await db
    .update(courseKuds)
    .set({ approvedAt: null, approvedByIpHash: null, updatedAt: new Date() })
    .where(eq(courseKuds.courseCode, courseCode));
}

export async function listKudRunsForCourse(courseCode: string) {
  const rows = await db
    .select()
    .from(courseKudRuns)
    .where(eq(courseKudRuns.courseCode, courseCode))
    .orderBy(desc(courseKudRuns.createdAt));
  return rows;
}
