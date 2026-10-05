import { parseCanvasBlob } from '@/lib/canvas/parseCanvasBlob';

/**
 * The names the guide may use, parsed from the course's `Canvas: Assignments`
 * text exactly as lib/canvas/assemble-canvas-materials.ts writes it:
 *   ## Name (N pts) [unpublished]
 *   <description>
 *   Rubric — Title:        (or "Rubric:")
 *   - Criterion (N pts) — long description
 *     ratings: ...
 */
export interface KnownAssignment { name: string; rubricRows: string[] }
export interface KnownNames { assignments: KnownAssignment[] }

const UNPUBLISHED_SUFFIX = /\s*\[unpublished\]\s*$/;
const POINTS_SUFFIX = /\s*\(-?\d+(?:\.\d+)?\s*pts\)\s*$/;
const RUBRIC_HEADER = /^Rubric(?: — .*)?:\s*$/;
const ROW_WITH_POINTS = /^(.*?)\s\(-?\d+(?:\.\d+)?\s*pts\)(?:\s—\s[\s\S]*)?$/;

/** Case- and whitespace-insensitive key; exact otherwise. */
export function normalizeName(s: string): string {
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function assignmentNameFromTitle(title: string): string {
  return title.replace(UNPUBLISHED_SUFFIX, '').replace(POINTS_SUFFIX, '').trim();
}

/** `body` is a rubric line without its leading "- ". */
export function rubricRowName(body: string): string {
  const m = ROW_WITH_POINTS.exec(body);
  if (m && m[1]) return m[1].trim();
  const dash = body.indexOf(' — ');
  return (dash >= 0 ? body.slice(0, dash) : body).trim();
}

export function parseCanvasAssignmentNames(text: string): KnownNames {
  const assignments: KnownAssignment[] = [];
  for (const item of parseCanvasBlob(text)) {
    const name = assignmentNameFromTitle(item.title);
    if (!name) continue;
    const rubricRows: string[] = [];
    let inRubric = false;
    for (const raw of item.body.split('\n')) {
      const line = raw.trimEnd();
      if (RUBRIC_HEADER.test(line.trim())) { inRubric = true; continue; }
      if (inRubric && line.startsWith('- ')) {
        const row = rubricRowName(line.slice(2));
        if (row) rubricRows.push(row);
      }
    }
    const existing = assignments.find((a) => normalizeName(a.name) === normalizeName(name));
    if (existing) existing.rubricRows.push(...rubricRows);
    else assignments.push({ name, rubricRows });
  }
  return { assignments };
}

export function findAssignment(known: KnownNames, name: string): KnownAssignment | null {
  const key = normalizeName(name);
  return known.assignments.find((a) => normalizeName(a.name) === key) ?? null;
}

export function findRubricRow(assignment: KnownAssignment, row: string): string | null {
  const key = normalizeName(row);
  return assignment.rubricRows.find((r) => normalizeName(r) === key) ?? null;
}
