import { eq } from 'drizzle-orm';
import { db } from '@/lib/db/client';
import { courseObjectiveGuides, courseCaptureSnapshots } from '@/lib/db/schema';
import type { ObjectiveGuide } from '@/lib/objective-guide/schema';
import { scrubForRecord, ScrubError } from '@/lib/privacy/scrub';
import { findResidualIdentifiers } from '@/lib/privacy/deterministic';

export interface StoredObjectiveGuide {
  courseCode: string;
  snapshotId: string;
  guide: ObjectiveGuide;
  droppedNames: string[];
  model: string;
  generatedAt: Date;
  /** When the capture the guide was built from was taken; null if that snapshot is gone. */
  snapshotCreatedAt: Date | null;
}

/** Every string leaf of a plain object/array tree, scrubbed; other values kept. */
async function scrubStrings<T>(value: T, fileName: string): Promise<T> {
  if (typeof value === 'string') {
    return (await scrubForRecord(value, { fileName, isSyllabus: false })).text as T;
  }
  if (Array.isArray(value)) {
    return (await Promise.all(value.map((v) => scrubStrings(v, fileName)))) as T;
  }
  if (value !== null && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value as Record<string, unknown>).map(async ([k, v]) => [k, await scrubStrings(v, fileName)] as const),
    );
    return Object.fromEntries(entries) as T;
  }
  return value;
}

/**
 * Privacy scrub for a guide before it is stored (spec 2026-10-05): the guide
 * is rendered on the public wiki at request time, outside writeAndPush. Every
 * string (and every dropped name) goes through scrubForRecord as a non-syllabus
 * record, then a hard email/CUID check. Throws an Error whose message carries
 * no guide text on any failure; callers then write nothing.
 */
async function scrubGuideForRecord(
  courseCode: string,
  guide: ObjectiveGuide,
  droppedNames: string[],
): Promise<{ guide: ObjectiveGuide; droppedNames: string[] }> {
  const withheld = (why: string) => new Error(`objective-guide ${courseCode}: withheld by the privacy check (${why})`);
  const fileName = `objective-guide:${courseCode}`;
  let out: { guide: ObjectiveGuide; droppedNames: string[] };
  try {
    out = { guide: await scrubStrings(guide, fileName), droppedNames: await scrubStrings(droppedNames, fileName) };
  } catch (err) {
    // ScrubError messages are text-free by construction; anything else may
    // echo its input, so only its name is kept.
    const why = err instanceof ScrubError ? err.message : err instanceof Error ? err.name : typeof err;
    throw withheld(`scrub failed: ${why}`);
  }
  const residual = findResidualIdentifiers(JSON.stringify(out));
  if (residual.length > 0) throw withheld(`${residual.length} pattern(s) remain`);
  return out;
}

/** The single writer of course_objective_guides: scrubs before storing (see scrubGuideForRecord). */
export async function upsertObjectiveGuide(input: {
  courseCode: string;
  snapshotId: string;
  guide: ObjectiveGuide;
  droppedNames: string[];
  model: string;
}): Promise<void> {
  const { guide, droppedNames } = await scrubGuideForRecord(input.courseCode, input.guide, input.droppedNames);
  const generatedAt = new Date();
  await db
    .insert(courseObjectiveGuides)
    .values({ ...input, guide, droppedNames, generatedAt })
    .onConflictDoUpdate({
      target: courseObjectiveGuides.courseCode,
      set: {
        snapshotId: input.snapshotId,
        guide,
        droppedNames,
        model: input.model,
        generatedAt,
      },
    });
}

export type RescrubGuideOutcome = 'missing' | 'unchanged' | 'changed' | 'withheld';

/**
 * Privacy backfill: re-scrub a guide stored before upsertObjectiveGuide
 * scrubbed. With `apply`, a changed guide is rewritten (guide + dropped names
 * only; snapshot, model and generatedAt are kept). A guide that fails the
 * scrub is left as is ('withheld') — the public read path hides it if it still
 * carries an email/CUID.
 */
export async function rescrubStoredObjectiveGuide(
  courseCode: string,
  opts: { apply: boolean },
): Promise<RescrubGuideOutcome> {
  const [row] = await db
    .select({ guide: courseObjectiveGuides.guide, droppedNames: courseObjectiveGuides.droppedNames })
    .from(courseObjectiveGuides)
    .where(eq(courseObjectiveGuides.courseCode, courseCode))
    .limit(1);
  if (!row) return 'missing';
  let out: { guide: ObjectiveGuide; droppedNames: string[] };
  try {
    out = await scrubGuideForRecord(courseCode, row.guide, row.droppedNames);
  } catch {
    return 'withheld';
  }
  if (JSON.stringify(out) === JSON.stringify({ guide: row.guide, droppedNames: row.droppedNames })) return 'unchanged';
  if (opts.apply) {
    await db
      .update(courseObjectiveGuides)
      .set({ guide: out.guide, droppedNames: out.droppedNames })
      .where(eq(courseObjectiveGuides.courseCode, courseCode));
  }
  return 'changed';
}

export async function getObjectiveGuide(courseCode: string): Promise<StoredObjectiveGuide | null> {
  const rows = await db
    .select({
      courseCode: courseObjectiveGuides.courseCode,
      snapshotId: courseObjectiveGuides.snapshotId,
      guide: courseObjectiveGuides.guide,
      droppedNames: courseObjectiveGuides.droppedNames,
      model: courseObjectiveGuides.model,
      generatedAt: courseObjectiveGuides.generatedAt,
      snapshotCreatedAt: courseCaptureSnapshots.createdAt,
    })
    .from(courseObjectiveGuides)
    .leftJoin(courseCaptureSnapshots, eq(courseCaptureSnapshots.id, courseObjectiveGuides.snapshotId))
    .where(eq(courseObjectiveGuides.courseCode, courseCode))
    .limit(1);
  return rows[0] ?? null;
}
