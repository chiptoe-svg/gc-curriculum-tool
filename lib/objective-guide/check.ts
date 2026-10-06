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

type Resolved =
  | { ok: true; evidence: GuideEvidence }
  // `droppedNames` is only the name(s) actually unverified — when just the
  // rubric row fails to match, the assignment it names is real and must not
  // be added to the scrub set (it would over-scrub legitimate mentions).
  | { ok: false; label: string; droppedNames: string[] };

function resolveEvidence(e: GuideEvidence, known: KnownNames): Resolved {
  const assignment = findAssignment(known, e.assignment);
  if (!assignment) return { ok: false, label: `assignment: ${e.assignment}`, droppedNames: [e.assignment] };
  if (e.rubric_row === null) return { ok: true, evidence: { assignment: assignment.name, rubric_row: null } };
  const row = findRubricRow(assignment, e.rubric_row);
  if (!row) return { ok: false, label: `rubric row: ${e.rubric_row} (under ${e.assignment})`, droppedNames: [e.rubric_row] };
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

/** Deterministic replacement `intro` text once a dropped name must be scrubbed out of it. */
const FALLBACK_INTRO =
  'This guide lists, for each course objective, the graded Canvas work that shows whether it was met and the class-level numbers to gather at the end of the semester.';

const containsAny = (text: string, normalizedNeedles: Set<string>): boolean => {
  if (normalizedNeedles.size === 0) return false;
  const haystack = normalizeName(text);
  for (const n of normalizedNeedles) if (haystack.includes(n)) return true;
  return false;
};

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
  // Guide-wide scrub set: every unverified assignment/rubric-row name, from
  // EVERY objective — including one that itself gets dropped for not being
  // in the syllabus — because a name dropped there can still leak into a
  // SURVIVING objective's gather/suggestion/intro (#1a, 2026-10-05 re-review).
  const droppedNamesAll = new Set<string>();

  // Pass 1: resolve every objective's evidence and collect drops guide-wide.
  type Prep = { objective: ModelGuide['objectives'][number]; inSyllabus: boolean; evidence: GuideEvidence[] };
  const preps: Prep[] = [];
  for (const o of draft.objectives) {
    const inSyllabus = objectiveInSyllabus(o.objective, syllabusText);
    if (!inSyllabus) dropped.add(objectiveLabel(o.objective));

    const seen = new Set<string>();
    const evidence: GuideEvidence[] = [];
    for (const e of o.evidence) {
      const r = resolveEvidence(e, known);
      if (!r.ok) {
        dropped.add(r.label);
        for (const n of r.droppedNames) droppedNamesAll.add(normalizeName(n));
        continue;
      }
      const key = evidenceKey(r.evidence);
      if (seen.has(key)) continue;
      seen.add(key);
      evidence.push(r.evidence);
    }
    preps.push({ objective: o, inSyllabus, evidence });
  }

  // Pass 2: build the surviving objectives, scrubbing gather/suggestion
  // against the FULL guide-wide drop set.
  const objectives: ObjectiveGuide['objectives'] = [];
  for (const prep of preps) {
    if (!prep.inSyllabus) continue;
    const { objective: o, evidence } = prep;

    const kept = evidence.slice(0, 3);
    const measure = kept.length === 0 ? 'none' : o.measure;
    // #2: never show evidence next to "No graded measure yet".
    const finalEvidence = measure === 'none' ? [] : kept;

    let gather = o.gather.trim();
    let suggestion = measure === 'clear' ? null : (o.suggestion?.trim() || null);

    // #1: the guide is never published with a dropped name that leaked into
    // free-text gather/suggestion (compare substring on normalizeName-normalized text).
    if (containsAny(gather, droppedNamesAll)) {
      gather = buildGatherFromEvidence(finalEvidence);
    }
    if (suggestion !== null && containsAny(suggestion, droppedNamesAll)) {
      suggestion = null;
    }

    objectives.push({
      objective: stripLeadingMarker(o.objective),
      measure,
      evidence: finalEvidence,
      gather,
      suggestion,
    });
  }

  // #1b: the intro is free text too — scrub it the same way.
  let intro = draft.intro.trim();
  if (containsAny(intro, droppedNamesAll)) {
    intro = FALLBACK_INTRO;
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

  return { guide: { intro, objectives, checklist }, dropped: [...dropped] };
}
