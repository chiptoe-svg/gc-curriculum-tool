import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';

/**
 * Create a sandbox course from a tester's entered code + title. The internal
 * `courses.code` is a generated, **namespaced** `EXT-…` value so it can never
 * collide with or touch a real GC course; the tester's entered code+title
 * become the display `title`. The course is `scope='external'/status='sandbox'`
 * — invisible to every program rollup. Returns the internal code.
 */
export async function createSandboxCourse(input: { enteredCode: string; title: string }): Promise<{ code: string }> {
  const code = `EXT-${randomUUID().slice(0, 8)}`;
  const entered = input.enteredCode.trim();
  const title = input.title.trim();
  const displayTitle = entered ? (title ? `${entered} — ${title}` : entered) : (title || 'Untitled sandbox course');
  await db.insert(courses).values({
    code,
    title: displayTitle,
    level: 1,          // NOT NULL; sandbox courses are excluded from level-based rollups
    track: 'External', // NOT NULL
    scope: 'external',
    status: 'sandbox',
  });
  return { code };
}

export interface SandboxCourseRow {
  code: string;
  title: string;
  createdAt: Date;
}

/** Every sandbox (external/sandbox) course, for the operator's /admin review list. */
export async function listSandboxCourses(): Promise<SandboxCourseRow[]> {
  return db
    .select({ code: courses.code, title: courses.title, createdAt: courses.lastSyncedAt })
    .from(courses)
    .where(and(eq(courses.scope, 'external'), eq(courses.status, 'sandbox')))
    .orderBy(desc(courses.lastSyncedAt));
}
