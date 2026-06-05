import { db } from './client';
import { courses, sheetSyncState, courseProfiles, courseMaterials, courseCaptureSnapshots } from './schema';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';
import { eq, asc, sql, count, inArray } from 'drizzle-orm';

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

// ---------------------------------------------------------------------------
// Course-roster helpers (Task 3 — prerequisite-edges plan)
// ---------------------------------------------------------------------------

/**
 * Data-state for a course in the roster.
 * - 'measured'  — at least one course_capture_snapshots row exists.
 * - 'intended'  — reserved for the rough-pass increment (not produced here yet).
 * - 'no-data'   — no snapshot; no capture data available.
 */
export type CourseDataState = 'measured' | 'intended' | 'no-data';

export interface CourseRosterRow {
  code: string;
  title: string;
  level: number;
  prerequisites: string;
  dataState: CourseDataState; // 'intended' is reserved; only 'measured'/'no-data' produced here
}

/**
 * Returns one row per course with its data-state badge value.
 * 'measured' iff a course_capture_snapshots row exists for the course.
 * Ordered by level then code.
 */
export async function getCourseDataStates(): Promise<CourseRosterRow[]> {
  const result = await db.execute(sql`
    SELECT c.code, c.title, c.level, c.prerequisites,
      CASE WHEN EXISTS (
        SELECT 1 FROM course_capture_snapshots s WHERE s.course_code = c.code
      ) THEN 'measured' ELSE 'no-data' END AS data_state
    FROM courses c
    ORDER BY c.level, c.code
  `);
  return (result.rows as Array<Record<string, unknown>>).map((r) => ({
    code: r['code'] as string,
    title: r['title'] as string,
    level: r['level'] as number,
    prerequisites: r['prerequisites'] as string,
    dataState: r['data_state'] as CourseDataState,
  }));
}

export interface NewCourseInput {
  code: string;
  title: string;
  level?: number;
  track?: string;
  prerequisites?: string;
}

/**
 * Idempotent bulk create: inserts only codes not already in courses.
 * Returns { created, skipped } code arrays.
 * Required NOT-NULL cols without DB defaults: code, title, level, track.
 * Defaults: level=0, track='unspecified', prerequisites=''.
 */
export async function bulkCreateCourses(
  items: NewCourseInput[],
): Promise<{ created: string[]; skipped: string[] }> {
  // Dedupe by trimmed code — keep first occurrence of each code.
  const seen = new Set<string>();
  const uniqueItems: NewCourseInput[] = [];
  for (const i of items) {
    const code = i.code.trim();
    if (code && !seen.has(code)) {
      seen.add(code);
      uniqueItems.push({ ...i, code });
    }
  }
  const codes = [...seen];
  if (codes.length === 0) return { created: [], skipped: [] };

  const existing = await db
    .select({ code: courses.code })
    .from(courses)
    .where(inArray(courses.code, codes));
  const have = new Set(existing.map((e) => e.code));

  const toCreate = uniqueItems.filter((i) => !have.has(i.code));
  for (const i of toCreate) {
    await db
      .insert(courses)
      .values({
        code: i.code,
        title: (i.title ?? i.code).trim(),
        level: i.level ?? 0,
        track: i.track ?? 'unspecified',
        prerequisites: i.prerequisites ?? '',
      })
      .onConflictDoNothing();
  }

  return {
    created: toCreate.map((i) => i.code),
    skipped: codes.filter((c) => have.has(c)),
  };
}

/**
 * Insert a single course (no-op if code already exists).
 * Required NOT-NULL cols without DB defaults: code, title, level, track.
 * Defaults: level=0, track='unspecified', prerequisites=''.
 */
export async function createCourse(input: NewCourseInput): Promise<void> {
  await db
    .insert(courses)
    .values({
      code: input.code.trim(),
      title: (input.title ?? input.code.trim()).trim(),
      level: input.level ?? 0,
      track: input.track ?? 'unspecified',
      prerequisites: input.prerequisites ?? '',
    })
    .onConflictDoNothing();
}

/** Returns true if a course with the given code exists in the courses table. */
export async function courseExists(code: string): Promise<boolean> {
  const [row] = await db
    .select({ code: courses.code })
    .from(courses)
    .where(eq(courses.code, code))
    .limit(1);
  return !!row;
}
