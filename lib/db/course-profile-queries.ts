import { eq, desc } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseMaterials, courseProfiles, courseProfileRuns } from '@/lib/db/schema';
import type { AnalysisFinding, CourseProfileResult } from '@/lib/ai/course-profile/schema';

export interface CacheAnalysisFindingInput {
  materialId: string;
  finding: AnalysisFinding;
  model: string;
  costUsdCents: number;
}

export async function cacheAnalysisFinding({
  materialId,
  finding,
  model,
  costUsdCents,
}: CacheAnalysisFindingInput): Promise<void> {
  await db
    .update(courseMaterials)
    .set({ analysisFinding: finding, analysisModel: model, analysisCostUsdCents: costUsdCents })
    .where(eq(courseMaterials.id, materialId));
}

export interface InsertProfileRunInput {
  courseCode: string;
  result: CourseProfileResult;
  materialCount: number;
  model: string;
  costUsdCents: number;
}

export async function insertProfileRun({
  courseCode,
  result,
  materialCount,
  model,
  costUsdCents,
}: InsertProfileRunInput): Promise<string> {
  const [row] = await db
    .insert(courseProfileRuns)
    .values({ courseCode, result, materialCount, model, costUsdCents })
    .returning({ id: courseProfileRuns.id });
  if (!row) throw new Error('insertProfileRun: no row returned');
  return row.id;
}

export interface UpsertCourseProfileInput {
  courseCode: string;
  result: CourseProfileResult;
  runId: string;
}

export async function upsertCourseProfile({
  courseCode,
  result,
  runId,
}: UpsertCourseProfileInput): Promise<void> {
  const existing = await db
    .select()
    .from(courseProfiles)
    .where(eq(courseProfiles.courseCode, courseCode));

  if (existing.length === 0) {
    await db
      .insert(courseProfiles)
      .values({
        courseCode,
        summary: result.summary,
        learningObjectives: result.learningObjectives,
        skills: result.skills,
        competencies: result.competencies,
        catalogDivergence: result.catalogDivergence,
        sourceRunId: runId,
        manuallyEdited: false,
        updatedAt: new Date(),
      })
      .returning();
  } else {
    await db
      .update(courseProfiles)
      .set({
        summary: result.summary,
        learningObjectives: result.learningObjectives,
        skills: result.skills,
        competencies: result.competencies,
        catalogDivergence: result.catalogDivergence,
        sourceRunId: runId,
        manuallyEdited: false,
        updatedAt: new Date(),
      })
      .where(eq(courseProfiles.courseCode, courseCode));
  }
}

export async function getLatestRunForCourse(courseCode: string) {
  const rows = await db
    .select()
    .from(courseProfileRuns)
    .where(eq(courseProfileRuns.courseCode, courseCode))
    .orderBy(desc(courseProfileRuns.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getCourseProfile(courseCode: string) {
  const rows = await db
    .select()
    .from(courseProfiles)
    .where(eq(courseProfiles.courseCode, courseCode));
  return rows[0] ?? null;
}

// ── Faculty-edit write path ──────────────────────────────────────────────────

export interface UpdateProfileFromEditInput {
  courseCode: string;
  summary: string;
  learningObjectives: string[];
  skills: string[];
  competencies: Array<{
    name: string;
    description: string;
    level: string;
    evidence: Array<{ fileName: string; quote: string }>;
  }>;
}

export async function updateProfileFromEdit({
  courseCode,
  summary,
  learningObjectives,
  skills,
  competencies,
}: UpdateProfileFromEditInput): Promise<void> {
  await db
    .update(courseProfiles)
    .set({
      summary,
      learningObjectives,
      skills,
      competencies,
      manuallyEdited: true,
      updatedAt: new Date(),
    })
    .where(eq(courseProfiles.courseCode, courseCode));
}
