import { db } from './client';
import { courses, sheetSyncState, courseProfiles, courseMaterials, courseCaptureSnapshots, courseIntendedCoverage } from './schema';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';
import { eq, asc, sql, count, inArray } from 'drizzle-orm';
import type { CourseCategory } from '@/lib/db/course-category-seed';
import { parseCourseCode, composeCourseCode } from '@/lib/courses/parse-course-code';

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

/**
 * Stamp the Canvas course name + import timestamp on the course row after a
 * successful canvas-import. Called by the canvas-import route.
 */
export async function updateCourseCanvasImport(
  code: string,
  canvasCourseName: string,
  canvasImportedAt: Date,
): Promise<void> {
  await db
    .update(courses)
    .set({ canvasCourseName, canvasImportedAt })
    .where(eq(courses.code, code));
}

export async function upsertCourses(parsed: ParsedCourse[]): Promise<number> {
  if (parsed.length === 0) return 0;
  const rows = parsed.map(p => {
    const pc = parseCourseCode(p.code);
    return {
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
      prefix: pc.prefix,
      courseNumber: pc.number,
      numberSuffix: pc.suffix,
    };
  });
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
      prefix: sql`excluded.prefix`,
      courseNumber: sql`excluded.course_number`,
      numberSuffix: sql`excluded.number_suffix`,
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
 * - 'measured'  — at least one course_capture_snapshots row exists (measured wins).
 * - 'intended'  — a course_intended_coverage row exists but no snapshot.
 * - 'no-data'   — no snapshot and no intended-coverage row.
 */
export type CourseDataState = 'measured' | 'intended' | 'no-data';

export interface CourseRosterRow {
  code: string;
  title: string;
  level: number;
  prerequisites: string;
  dataState: CourseDataState;
}

/**
 * Returns one row per course with its data-state badge value.
 * 'measured' when a course_capture_snapshots row exists (measured wins).
 * 'intended' when a course_intended_coverage row exists but no snapshot.
 * 'no-data' otherwise.
 * Ordered by level then code.
 */
export async function getCourseDataStates(): Promise<CourseRosterRow[]> {
  const result = await db.execute(sql`
    SELECT c.code, c.title, c.level, c.prerequisites,
      CASE
        WHEN EXISTS (SELECT 1 FROM course_capture_snapshots s WHERE s.course_code = c.code) THEN 'measured'
        WHEN EXISTS (SELECT 1 FROM course_intended_coverage i WHERE i.course_code = c.code) THEN 'intended'
        ELSE 'no-data'
      END AS data_state
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

// ---------------------------------------------------------------------------
// Intended-coverage queries (Task 2 — intended-skills rough-pass plan)
// ---------------------------------------------------------------------------

export interface IntendedCoverageRow {
  courseCode: string;
  subCompetencyId: string;
  intendedK: number | null;
  intendedU: number | null;
  intendedD: number | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

export interface NewIntendedRow {
  subCompetencyId: string;
  intendedK: number | null;
  intendedU: number | null;
  intendedD: number | null;
  confidence: 'high' | 'medium' | 'low';
  rationale: string;
}

/**
 * Sanitize a single intended K/U/D depth value.
 * Valid values are integers 0–5 (inclusive).  Anything outside that range,
 * non-finite, or non-integer is replaced with null so the row can still be
 * inserted without triggering a constraint failure.
 *
 * Exported for unit tests; not intended for external callers.
 */
export function sanitizeIntendedDepth(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!isFinite(v)) return null;
  const rounded = Math.round(v);
  if (rounded < 0 || rounded > 5) return null;
  return rounded;
}

/**
 * Replace a course's intended coverage atomically (delete-then-insert in a tx).
 * Idempotent: re-running with the same rows produces the same result.
 * No-op insert when rows is empty (delete still fires to clear stale data).
 *
 * Two-layer poison-row defence:
 * 1. Each row's K/U/D depths are sanitized to 0–5 or null before insert.
 *    Out-of-range values from the extractor are common (e.g., 6 from an
 *    off-by-one LLM) and would overflow the integer constraint, aborting
 *    the whole tx and rolling back the delete — leaving the course with
 *    stale data AND no new data.
 * 2. The insert runs inside a Drizzle nested transaction (Postgres SAVEPOINT).
 *    If the cleaned batch still throws (e.g., FK violation on an unknown
 *    sub_competency_id), we fall back to inserting each row individually in
 *    its own SAVEPOINT; rows that fail are skipped (logged) so survivors
 *    persist.  The outer delete is never rolled back.
 */
export async function replaceIntendedCoverage(
  courseCode: string,
  rows: NewIntendedRow[],
  model: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(courseIntendedCoverage).where(eq(courseIntendedCoverage.courseCode, courseCode));
    if (rows.length === 0) return;

    // Layer 1: sanitize every depth value.
    const cleaned = rows.map((r) => ({
      courseCode,
      subCompetencyId: r.subCompetencyId,
      intendedK: sanitizeIntendedDepth(r.intendedK),
      intendedU: sanitizeIntendedDepth(r.intendedU),
      intendedD: sanitizeIntendedDepth(r.intendedD),
      confidence: r.confidence,
      rationale: r.rationale,
      model,
    }));

    // Layer 2: SAVEPOINT-protected bulk insert with per-row fallback.
    // A plain pg transaction aborts on ANY error — there is no way to
    // catch-and-continue inside the same tx without a SAVEPOINT.
    // Drizzle's nested tx.transaction() maps to SAVEPOINT/ROLLBACK TO SAVEPOINT.
    try {
      await tx.transaction(async (b) => {
        await b.insert(courseIntendedCoverage).values(cleaned);
      });
    } catch (bulkErr) {
      console.warn(
        `replaceIntendedCoverage: bulk insert failed for ${courseCode} (poison row?), falling back to row-by-row — ${String(bulkErr)}`,
      );
      for (const row of cleaned) {
        try {
          await tx.transaction(async (b) => {
            await b.insert(courseIntendedCoverage).values(row);
          });
        } catch (rowErr) {
          console.warn(
            `replaceIntendedCoverage: skipping row ${row.subCompetencyId} for ${courseCode} — ${String(rowErr)}`,
          );
        }
      }
    }
  });
}

/** Return all intended-coverage rows for a single course. */
export async function getIntendedCoverageForCourse(courseCode: string): Promise<IntendedCoverageRow[]> {
  const rows = await db
    .select()
    .from(courseIntendedCoverage)
    .where(eq(courseIntendedCoverage.courseCode, courseCode));
  return rows as IntendedCoverageRow[];
}

/**
 * Batch lookup for the gap engine: intended rows for a set of (prereq) courses.
 * Returns [] immediately for empty input (no query issued).
 */
export async function getIntendedCoverageForCourses(
  courseCodes: string[],
): Promise<IntendedCoverageRow[]> {
  if (courseCodes.length === 0) return [];
  const rows = await db
    .select()
    .from(courseIntendedCoverage)
    .where(inArray(courseIntendedCoverage.courseCode, courseCodes));
  return rows as IntendedCoverageRow[];
}

/**
 * Course codes that lack any measured snapshot — the rough-pass targets.
 * These are courses where only intended (or no) coverage data exists.
 */
export async function listUncapturedCourseCodes(): Promise<string[]> {
  const rows = await db.execute(sql`
    SELECT c.code FROM courses c
    WHERE NOT EXISTS (SELECT 1 FROM course_capture_snapshots s WHERE s.course_code = c.code)
    ORDER BY c.code
  `);
  return rows.rows.map((r: any) => r.code as string);
}

export interface NewCourseInput {
  code: string;
  title: string;
  level?: number;
  track?: string;
  prerequisites?: string;
  catalogUrl?: string | null;
  pairedCode?: string;
  pairedRole?: 'lecture' | 'lab' | 'other';
}

/**
 * Display label for a (possibly bundled) course. No paired codes → the bare
 * code. Paired codes sharing the prefix collapse to "GC 3460/3461"; differing
 * prefixes join with " + ". Spec 2026-06-13.
 */
export function formatCourseLabel(
  code: string,
  pairedCodes: ReadonlyArray<{ pairedCode: string; [key: string]: unknown }>,
): string {
  if (pairedCodes.length === 0) return code;
  const base = parseCourseCode(code);
  const parts = pairedCodes.map(p => {
    const pc = parseCourseCode(p.pairedCode);
    return pc.prefix === base.prefix && pc.number !== null ? `${pc.number}${pc.suffix}` : p.pairedCode;
  });
  const sameAll = pairedCodes.every(p => parseCourseCode(p.pairedCode).prefix === base.prefix);
  return sameAll ? `${code}/${parts.join('/')}` : `${code} + ${parts.join(' + ')}`;
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
  if (toCreate.length > 0) {
    // Single batched insert (was a per-row loop). onConflictDoNothing keeps it
    // safe against a race that inserts a code between the existence check above
    // and this write.
    await db
      .insert(courses)
      .values(toCreate.map((i) => {
        const p = parseCourseCode(i.code);
        return {
          code: i.code,
          title: (i.title ?? i.code).trim(),
          level: i.level ?? 0,
          track: i.track ?? 'unspecified',
          prerequisites: i.prerequisites ?? '',
          catalogUrl: i.catalogUrl?.trim() || null,
          prefix: p.prefix,
          courseNumber: p.number,
          numberSuffix: p.suffix,
        };
      }))
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
 * Optionally creates a paired-code row when pairedCode + pairedRole are given.
 */
export async function createCourse(input: NewCourseInput): Promise<void> {
  const code = input.code.trim();
  const parsed = parseCourseCode(code);
  await db
    .insert(courses)
    .values({
      code,
      title: (input.title ?? code).trim(),
      level: input.level ?? 0,
      track: input.track ?? 'unspecified',
      prerequisites: input.prerequisites ?? '',
      catalogUrl: input.catalogUrl?.trim() || null,
      prefix: parsed.prefix,
      courseNumber: parsed.number,
      numberSuffix: parsed.suffix,
    })
    .onConflictDoNothing();

  if (input.pairedCode && input.pairedRole) {
    const paired = composeCourseCode(parseCourseCode(input.pairedCode.trim()));
    if (paired) {
      const { addPairedCode } = await import('@/lib/db/course-codes-queries');
      await addPairedCode({ courseCode: code, pairedCode: paired, role: input.pairedRole }).catch(() => { /* paired-code uniqueness: ignore dup */ });
    }
  }
}

export interface CourseClassificationPatch {
  category?: CourseCategory;
  buildsToCareer?: boolean;
  catalogUrl?: string | null;
}

/**
 * Update a course's classification fields. Each field is independently
 * optional; only provided keys are written. Returns true if the course exists.
 */
export async function updateCourseClassification(
  code: string,
  patch: CourseClassificationPatch,
): Promise<boolean> {
  const set: Record<string, unknown> = {};
  if (patch.category !== undefined) set.category = patch.category;
  if (patch.buildsToCareer !== undefined) set.buildsToCareer = patch.buildsToCareer;
  if (patch.catalogUrl !== undefined) set.catalogUrl = patch.catalogUrl;
  if (Object.keys(set).length === 0) return courseExists(code);

  const updated = await db
    .update(courses)
    .set(set)
    .where(eq(courses.code, code))
    .returning({ code: courses.code });
  return updated.length > 0;
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
