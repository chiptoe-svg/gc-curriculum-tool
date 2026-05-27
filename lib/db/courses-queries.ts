import { db } from './client';
import { courses, sheetSyncState, courseProfiles, courseMaterials } from './schema';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';
import { eq, asc, sql, count } from 'drizzle-orm';

export interface CourseListItem {
  code: string;
  title: string;
  level: number;
  track: string;
  builderStatus: string;
}

export interface CourseWithStatus {
  code: string;
  title: string;
  level: number;
  track: string;
  builderStatus: string;
  profileExists: boolean;
  manuallyEdited: boolean;
  materialCount: number;
}

export async function listCourses(): Promise<CourseListItem[]> {
  const rows = await db
    .select({
      code: courses.code,
      title: courses.title,
      level: courses.level,
      track: courses.track,
      builderStatus: courses.builderStatus,
    })
    .from(courses)
    .orderBy(asc(courses.code));
  return rows;
}

export async function getCourseByCode(code: string) {
  const rows = await db.select().from(courses).where(eq(courses.code, code)).limit(1);
  return rows[0] ?? null;
}

/**
 * Sets the per-course audit mode. 'simple' tells the audit pipeline to
 * skip chunk indexing and feed digests inline; 'full' (default) enables
 * retrieval over indexed chunks. Returns false if the course code was
 * not found.
 */
export async function setCourseAuditMode(
  code: string,
  auditMode: 'full' | 'simple',
): Promise<boolean> {
  const rows = await db
    .update(courses)
    .set({ auditMode })
    .where(eq(courses.code, code))
    .returning({ code: courses.code });
  return rows.length > 0;
}

export async function upsertCourses(parsed: ParsedCourse[]): Promise<number> {
  if (parsed.length === 0) return 0;
  const rows = parsed.map(p => ({
    code: p.code,
    title: p.title,
    level: p.level,
    track: p.track,
    description: p.description,
    prerequisites: p.prerequisites,
    syllabusUrl: p.syllabusUrl,
    learningObjectives: p.learningObjectives,
    majorProjects: p.majorProjects,
    skillsRequired: p.skillsRequired,
    lastSyncedAt: new Date(),
  }));
  // Upsert by code primary key.
  await db.insert(courses).values(rows).onConflictDoUpdate({
    target: courses.code,
    set: {
      title: sql`excluded.title`,
      level: sql`excluded.level`,
      track: sql`excluded.track`,
      description: sql`excluded.description`,
      prerequisites: sql`excluded.prerequisites`,
      syllabusUrl: sql`excluded.syllabus_url`,
      learningObjectives: sql`excluded.learning_objectives`,
      majorProjects: sql`excluded.major_projects`,
      skillsRequired: sql`excluded.skills_required`,
      lastSyncedAt: sql`excluded.last_synced_at`,
    },
  });
  return rows.length;
}

export async function recordSyncResult(count: number, errors: string[]): Promise<void> {
  await db.insert(sheetSyncState).values({
    key: 'courses',
    lastSyncedAt: new Date(),
    lastSyncedCount: count,
    lastErrors: errors,
  }).onConflictDoUpdate({
    target: sheetSyncState.key,
    set: {
      lastSyncedAt: sql`excluded.last_synced_at`,
      lastSyncedCount: sql`excluded.last_synced_count`,
      lastErrors: sql`excluded.last_errors`,
    },
  });
}

export async function getSyncState() {
  const rows = await db.select().from(sheetSyncState).where(eq(sheetSyncState.key, 'courses')).limit(1);
  return rows[0] ?? null;
}

export async function updateBuilderStatus(
  courseCode: string,
  status: 'draft' | 'materials_uploaded' | 'profile_complete' | 'kuds_generated' | 'approved',
): Promise<void> {
  await db.update(courses).set({ builderStatus: status }).where(eq(courses.code, courseCode));
}

export async function listApprovedCourses(): Promise<CourseListItem[]> {
  const rows = await db
    .select({
      code: courses.code,
      title: courses.title,
      level: courses.level,
      track: courses.track,
      builderStatus: courses.builderStatus,
    })
    .from(courses)
    .where(eq(courses.builderStatus, 'approved'))
    .orderBy(asc(courses.code));
  return rows;
}

export async function listCoursesWithStatus(): Promise<CourseWithStatus[]> {
  const rows = await db
    .select({
      code: courses.code,
      title: courses.title,
      level: courses.level,
      track: courses.track,
      builderStatus: courses.builderStatus,
      manuallyEdited: courseProfiles.manuallyEdited,
      materialCount: count(courseMaterials.id),
    })
    .from(courses)
    .leftJoin(courseProfiles, eq(courses.code, courseProfiles.courseCode))
    .leftJoin(courseMaterials, eq(courses.code, courseMaterials.courseCode))
    .groupBy(courses.code, courses.title, courses.level, courses.track, courses.builderStatus, courseProfiles.manuallyEdited)
    .orderBy(sql`${courses.level} asc, ${courses.code} asc`);

  return rows.map((r) => ({
    code: r.code,
    title: r.title,
    level: r.level,
    track: r.track,
    builderStatus: r.builderStatus,
    profileExists: r.manuallyEdited !== null,
    manuallyEdited: r.manuallyEdited ?? false,
    materialCount: Number(r.materialCount),
  }));
}
