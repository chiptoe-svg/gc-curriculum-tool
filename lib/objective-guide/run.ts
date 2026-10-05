import { getSnapshotById, getLatestSnapshotByCourse } from '@/lib/db/capture-snapshots-queries';
import { getCourseByCode } from '@/lib/db/courses-queries';
import { listMaterialsByCourse } from '@/lib/db/course-materials-queries';
import { upsertObjectiveGuide } from '@/lib/db/objective-guides-queries';
import { checkDailyCap } from '@/lib/rate-limit/daily-cap';
import { generateObjectiveGuide } from './generate';
import { pickSyllabus, usableAssignmentsText } from './inputs';

export type GuideSkipReason =
  | 'snapshot-not-found' | 'course-not-found' | 'no-syllabus' | 'syllabus-set-aside'
  | 'no-assignments' | 'daily-cap' | 'superseded';

export type GuideRunResult =
  | { status: 'written'; courseCode: string; objectives: number; droppedNames: string[]; costUsdCents: number }
  | { status: 'skipped'; courseCode: string | null; reason: GuideSkipReason };

/**
 * Build and store the objective assessment guide for one snapshot. Runs as its
 * own background task after snapshot creation (and from the backfill script).
 * A course with no usable syllabus — including one whose syllabus is set aside —
 * is skipped before any AI call.
 */
export async function runObjectiveGuideForSnapshot(snapshotId: string): Promise<GuideRunResult> {
  const snapshot = await getSnapshotById(snapshotId);
  if (!snapshot) return { status: 'skipped', courseCode: null, reason: 'snapshot-not-found' };
  const courseCode = snapshot.courseCode;

  const course = await getCourseByCode(courseCode);
  if (!course) return { status: 'skipped', courseCode, reason: 'course-not-found' };

  const materials = await listMaterialsByCourse(courseCode);
  const syllabus = pickSyllabus(materials);
  if (syllabus.status !== 'ok') return { status: 'skipped', courseCode, reason: syllabus.status };

  const assignmentsText = usableAssignmentsText(materials);
  if (assignmentsText === null) return { status: 'skipped', courseCode, reason: 'no-assignments' };

  const cap = await checkDailyCap();
  if (!cap.ok) return { status: 'skipped', courseCode, reason: 'daily-cap' };

  const result = await generateObjectiveGuide({
    courseCode,
    courseTitle: course.title,
    syllabi: syllabus.syllabi,
    assignmentsText,
    profile: snapshot.profile,
  });

  // A newer snapshot may have landed while the model was working; its own task
  // will write the guide, so never overwrite it with an older one.
  const latest = await getLatestSnapshotByCourse(courseCode);
  if (latest && latest.id !== snapshotId) return { status: 'skipped', courseCode, reason: 'superseded' };

  await upsertObjectiveGuide({
    courseCode,
    snapshotId,
    guide: result.guide,
    droppedNames: result.droppedNames,
    model: result.model,
  });
  if (result.droppedNames.length > 0) {
    console.warn(`[objective-guide] ${courseCode}: dropped ${result.droppedNames.length} unmatched item(s): ${result.droppedNames.join(' | ')}`);
  }
  return {
    status: 'written',
    courseCode,
    objectives: result.guide.objectives.length,
    droppedNames: result.droppedNames,
    costUsdCents: result.costUsdCents,
  };
}
