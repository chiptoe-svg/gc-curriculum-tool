import { db } from './client';
import { courses, sheetSyncState } from './schema';
import type { ParsedCourse } from '@/lib/sheets/parseCourseTab';
import { eq, asc, sql } from 'drizzle-orm';

export interface CourseListItem {
  code: string;
  title: string;
  level: number;
  track: string;
}

export async function listCourses(): Promise<CourseListItem[]> {
  const rows = await db
    .select({ code: courses.code, title: courses.title, level: courses.level, track: courses.track })
    .from(courses)
    .orderBy(asc(courses.code));
  return rows;
}

export async function getCourseByCode(code: string) {
  const rows = await db.select().from(courses).where(eq(courses.code, code)).limit(1);
  return rows[0] ?? null;
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
