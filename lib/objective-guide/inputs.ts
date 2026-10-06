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

/** Drops later materials whose extracted text exactly matches an earlier one
 *  (e.g. two identical .docx uploads of the same syllabus), keeping the first. */
function dedupeByText(materials: GuideMaterial[]): GuideMaterial[] {
  const seen = new Set<string>();
  const out: GuideMaterial[] = [];
  for (const m of materials) {
    const text = (m.extractedText ?? '').trim();
    if (seen.has(text)) continue;
    seen.add(text);
    out.push(m);
  }
  return out;
}

/**
 * The usable syllabus: flagged, not retired, not ignored, with text. `ignored`
 * is the app-wide "don't send to the AI" flag, so a FERPA auto-set-aside
 * syllabus is never used; once faculty include it (ignored=false) it is.
 */
export function pickSyllabus(materials: GuideMaterial[]): SyllabusPick {
  const flagged = materials.filter((m) => m.isSyllabus && !m.retiredAt);
  const usable = dedupeByText(flagged.filter((m) => !m.ignored && hasText(m)));
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
