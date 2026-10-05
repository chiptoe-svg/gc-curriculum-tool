import { filterCanvasBlob } from '@/lib/canvas/parseCanvasBlob';

/** The material fields the guide inputs depend on (a CourseMaterialRow fits). */
export interface GuideMaterial {
  id: string;
  fileName: string;
  isSyllabus: boolean;
  ignored: boolean;
  retiredAt: Date | string | null;
  extractedText: string | null;
  ignoredItems?: readonly string[] | null;
}

export type SyllabusPick =
  | { status: 'ok'; syllabi: Array<{ id: string; fileName: string; text: string }> }
  | { status: 'no-syllabus' }
  | { status: 'syllabus-set-aside' };

const hasText = (m: GuideMaterial) => (m.extractedText ?? '').trim().length > 0;

/**
 * The usable syllabus: flagged, not retired, not ignored, with text. `ignored`
 * is the app-wide "don't send to the AI" flag, so a FERPA auto-set-aside
 * syllabus is never used; once faculty include it (ignored=false) it is.
 */
export function pickSyllabus(materials: GuideMaterial[]): SyllabusPick {
  const flagged = materials.filter((m) => m.isSyllabus && !m.retiredAt);
  const usable = flagged.filter((m) => !m.ignored && hasText(m));
  if (usable.length > 0) {
    return { status: 'ok', syllabi: usable.map((m) => ({ id: m.id, fileName: m.fileName, text: m.extractedText as string })) };
  }
  if (flagged.some((m) => m.ignored)) return { status: 'syllabus-set-aside' };
  return { status: 'no-syllabus' };
}

/** Text of every usable `Canvas: Assignments` row, per-item ignores removed. */
export function usableAssignmentsText(materials: GuideMaterial[]): string | null {
  const parts = materials
    .filter((m) => m.fileName === 'Canvas: Assignments' && !m.ignored && !m.retiredAt && hasText(m))
    .map((m) => filterCanvasBlob(m.extractedText as string, m.ignoredItems ?? []).trim())
    .filter((t) => t.length > 0);
  return parts.length > 0 ? parts.join('\n\n') : null;
}
