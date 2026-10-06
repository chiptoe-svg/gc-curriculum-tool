import { sql } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courses } from '@/lib/db/schema';
import { getObjectiveGuide, type StoredObjectiveGuide } from '@/lib/db/objective-guides-queries';
import { getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { listSyllabusMaterials } from '@/lib/db/course-materials-queries';
import { pickSyllabus, type SyllabusPick } from '@/lib/objective-guide/inputs';
import { renderGuideText, renderGuideCanvasPrompt } from '@/lib/objective-guide/render';
import type { ObjectiveGuide } from '@/lib/objective-guide/schema';
import { findResidualIdentifiers } from '@/lib/privacy/deterministic';

export type ObjectiveGuideSection =
  | { kind: 'guide'; guide: ObjectiveGuide; text: string; canvasPrompt: string; capturedOn: string }
  | { kind: 'no-syllabus' }
  | { kind: 'syllabus-set-aside' };

/**
 * What the fourth course-page section shows. A stored guide always wins. With
 * no guide, a captured course is told why (no syllabus / syllabus set aside);
 * an uncaptured course, or one whose guide is simply not built yet, gets no
 * section.
 */
export function decideGuideSection(args: {
  course: { code: string; title: string };
  stored: StoredObjectiveGuide | null;
  hasSnapshot: boolean;
  syllabus: SyllabusPick;
}): ObjectiveGuideSection | null {
  const { course, hasSnapshot, syllabus } = args;
  let { stored } = args;
  // Privacy read-time defence: a guide stored before upsertObjectiveGuide
  // scrubbed may still carry an email/CUID. Treat it as absent; log only the
  // course code and the count, never the matched text.
  if (stored) {
    const residual = findResidualIdentifiers(JSON.stringify(stored.guide));
    if (residual.length > 0) {
      console.error(`[objective-guide] ${course.code}: stored guide hidden by the privacy check (${residual.length} pattern(s))`);
      stored = null;
    }
  }
  if (stored) {
    const capturedOn = (stored.snapshotCreatedAt ?? stored.generatedAt).toISOString().slice(0, 10);
    return {
      kind: 'guide',
      guide: stored.guide,
      text: renderGuideText(stored.guide, course),
      canvasPrompt: renderGuideCanvasPrompt(stored.guide, course),
      capturedOn,
    };
  }
  if (!hasSnapshot) return null;
  if (syllabus.status === 'syllabus-set-aside') return { kind: 'syllabus-set-aside' };
  if (syllabus.status === 'no-syllabus') return { kind: 'no-syllabus' };
  return null;
}

export async function loadObjectiveGuideSection(codeAnyCase: string): Promise<ObjectiveGuideSection | null> {
  // Wiki slugs upper-case letter suffixes ("GC 4900AP"); the DB stores "GC 4900ap".
  const [course] = await db
    .select({ code: courses.code, title: courses.title })
    .from(courses)
    .where(sql`lower(${courses.code}) = lower(${codeAnyCase})`)
    .limit(1);
  if (!course) return null;
  const [stored, snapshot, syllabusRows] = await Promise.all([
    getObjectiveGuide(course.code),
    getLatestSnapshotByCourse(course.code),
    listSyllabusMaterials(course.code),
  ]);
  return decideGuideSection({ course, stored, hasSnapshot: snapshot !== null, syllabus: pickSyllabus(syllabusRows) });
}
