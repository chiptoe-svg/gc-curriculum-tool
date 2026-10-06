import { normalizeName, findAssignment, findRubricRow, type KnownNames } from './canvas-names';
import type { GuideEvidence, ModelGuide, ObjectiveGuide } from './schema';

// A leading bullet glyph, "1." / "1)" / "(1)" numbering, or "a." / "a)" lettering.
const LEADING_MARKER = /^\s*(?:[•●▪◦·*–—-]|\(?\d{1,2}[.)]|\(?[a-zA-Z][.)])\s+/;

export function stripLeadingMarker(s: string): string {
  return s.replace(LEADING_MARKER, '').trim();
}

/** Bullet- and whitespace-insensitive form used for the verbatim check. */
export function normalizeForQuote(s: string): string {
  return s
    .split(/\r?\n/)
    .map((line) => line.replace(LEADING_MARKER, ''))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function objectiveInSyllabus(objective: string, syllabusText: string): boolean {
  const needle = normalizeForQuote(objective);
  if (needle.length === 0) return false;
  return normalizeForQuote(syllabusText).includes(needle);
}

const objectiveLabel = (objective: string) => `objective: ${objective}`;

type Resolved = { ok: true; evidence: GuideEvidence } | { ok: false; label: string };

function resolveEvidence(e: GuideEvidence, known: KnownNames): Resolved {
  const assignment = findAssignment(known, e.assignment);
  if (!assignment) return { ok: false, label: `assignment: ${e.assignment}` };
  if (e.rubric_row === null) return { ok: true, evidence: { assignment: assignment.name, rubric_row: null } };
  const row = findRubricRow(assignment, e.rubric_row);
  if (!row) return { ok: false, label: `rubric row: ${e.rubric_row} (under ${e.assignment})` };
  return { ok: true, evidence: { assignment: assignment.name, rubric_row: row } };
}

/** Everything the retry must fix, in reading order, deduplicated. */
export function findGuideProblems(draft: ModelGuide, known: KnownNames, syllabusText: string): string[] {
  const problems = new Set<string>();
  for (const o of draft.objectives) {
    if (!objectiveInSyllabus(o.objective, syllabusText)) problems.add(objectiveLabel(o.objective));
    for (const e of o.evidence) {
      const r = resolveEvidence(e, known);
      if (!r.ok) problems.add(r.label);
    }
  }
  return [...problems];
}

const evidenceKey = (e: GuideEvidence) =>
  `${normalizeName(e.assignment)}\u0000${e.rubric_row === null ? '' : normalizeName(e.rubric_row)}`;

/**
 * Local to avoid coupling check.ts to render.ts. Matches the spec's own
 * phrasing for `gather` text ("the score distribution on the 'Strategic
 * rationale' row of the Final Brand Playbook rubric, ...").
 */
function formatEvidenceForGather(e: GuideEvidence): string {
  return e.rubric_row ? `the '${e.rubric_row}' row of the ${e.assignment} rubric` : e.assignment;
}

/** Deterministic replacement `gather` text once a dropped name must be scrubbed out of it. */
function buildGatherFromEvidence(evidence: GuideEvidence[]): string {
  if (evidence.length === 0) {
    return 'Once a graded measure exists, the score distribution on it and the share of students at proficient or above.';
  }
  return `The score distribution on ${evidence.map(formatEvidenceForGather).join(' and ')}, and the share of students at proficient or above.`;
}

/**
 * The firm rule: the stored guide names only Canvas items that exist and only
 * objectives the syllabus states. Unmatched items are dropped (and recorded);
 * an objective left with no evidence becomes `none`; names take their Canvas
 * spelling; the checklist is derived from the surviving evidence.
 */
export function finalizeGuide(
  draft: ModelGuide,
  known: KnownNames,
  syllabusText: string,
): { guide: ObjectiveGuide; dropped: string[] } {
  const dropped = new Set<string>();
  const objectives: ObjectiveGuide['objectives'] = [];

  for (const o of draft.objectives) {
    if (!objectiveInSyllabus(o.objective, syllabusText)) {
      dropped.add(objectiveLabel(o.objective));
      continue;
    }
    const seen = new Set<string>();
    const evidence: GuideEvidence[] = [];
    const droppedNames: string[] = [];
    for (const e of o.evidence) {
      const r = resolveEvidence(e, known);
      if (!r.ok) {
        dropped.add(r.label);
        droppedNames.push(e.assignment);
        if (e.rubric_row !== null) droppedNames.push(e.rubric_row);
        continue;
      }
      const key = evidenceKey(r.evidence);
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(r.evidence);
    }
    const kept = evidence.slice(0, 3);
    const measure = kept.length === 0 ? 'none' : o.measure;
    // #2: never show evidence next to "No graded measure yet".
    const finalEvidence = measure === 'none' ? [] : kept;

    let gather = o.gather.trim();
    let suggestion = measure === 'clear' ? null : (o.suggestion?.trim() || null);

    // #1: the guide is never published with a dropped name that leaked into
    // free-text gather/suggestion (compare substring on normalizeName-normalized text).
    if (droppedNames.length > 0) {
      const normDropped = droppedNames.map(normalizeName);
      if (normDropped.some((n) => normalizeName(gather).includes(n))) {
        gather = buildGatherFromEvidence(finalEvidence);
      }
      if (suggestion !== null && normDropped.some((n) => normalizeName(suggestion as string).includes(n))) {
        suggestion = null;
      }
    }

    objectives.push({
      objective: stripLeadingMarker(o.objective),
      measure,
      evidence: finalEvidence,
      gather,
      suggestion,
    });
  }

  const checklist: GuideEvidence[] = [];
  const seenAll = new Set<string>();
  for (const o of objectives) {
    for (const e of o.evidence) {
      const key = evidenceKey(e);
      if (seenAll.has(key)) continue;
      seenAll.add(key);
      checklist.push(e);
    }
  }

  return { guide: { intro: draft.intro.trim(), objectives, checklist }, dropped: [...dropped] };
}
