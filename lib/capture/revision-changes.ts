/**
 * Revision change list (spec 2026-11-08-course-revision-modes-labels-design.md).
 *
 * After a re-score that started from an approved snapshot, compare the scored
 * profile with that baseline: every competency whose K/U/D moved, appeared or
 * disappeared becomes a change, labeled by whether it cites new evidence (an
 * answer from this interview, a new or edited file). Nothing is hidden — the
 * label informs the decision. In `targeted` mode a change without new evidence
 * starts as undone (the approved rating is kept unless faculty keep the change);
 * every other change waits for faculty. Pure: no I/O.
 */
import type {
  CaptureProfile,
  CaptureCompetency,
  CaptureProfileCitationType,
  Revision,
  RevisionChange,
} from '@/lib/ai/capture/schema';

export function normalizeStatement(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Top-level profile sections compared against the baseline (shown with a
 *  "Changed since the approved version" tag; never block approval). */
export const REVISION_SECTIONS = [
  'overview',
  'incoming_expectations',
  'verification_summary',
  'audit_notes',
  'revised_objectives_draft',
  'course_emphasis',
  'class_structure',
  'major_projects',
] as const;

const DIMS = ['k', 'u', 'd'] as const;
const depth = (c: CaptureCompetency | null, dim: 'k' | 'u' | 'd'): number | null =>
  c ? (dim === 'k' ? c.k_depth : dim === 'u' ? c.u_depth : c.d_depth) : null;

function dimsBetween(before: CaptureCompetency | null, after: CaptureCompetency | null): RevisionChange['dims'] {
  return DIMS.flatMap(dim => {
    const from = depth(before, dim);
    const to = depth(after, dim);
    return from === to ? [] : [{ dim, from, to }];
  });
}

/** Point every competency reference in the profile's other sections at the
 *  baseline wording when it matches a baseline statement once normalized. */
function rewriteReferences(profile: CaptureProfile, wording: Map<string, string>): CaptureProfile {
  const fix = (s: string) => wording.get(normalizeStatement(s)) ?? s;
  return {
    ...profile,
    course_emphasis: profile.course_emphasis?.map(e => ({ ...e, competency: fix(e.competency) })) ?? profile.course_emphasis,
    major_projects: profile.major_projects?.map(p => ({ ...p, competencies: p.competencies.map(fix) })) ?? profile.major_projects,
    reviewer_overrides: profile.reviewer_overrides?.map(o => ({ ...o, statement: fix(o.statement) })) ?? profile.reviewer_overrides,
  };
}

export function buildRevisionChanges(input: {
  mode: 'targeted' | 'recheck';
  baselineSnapshotId: string;
  baseline: CaptureProfile;
  scored: CaptureProfile;
  isNewCitation: (c: CaptureProfileCitationType) => boolean;
  isStaleCitation: (c: CaptureProfileCitationType) => boolean;
}): CaptureProfile {
  const { mode, baseline, isNewCitation, isStaleCitation } = input;
  const baseByKey = new Map(baseline.competencies.map(c => [normalizeStatement(c.statement), c]));
  const wording = new Map([...baseByKey].map(([k, c]) => [k, c.statement]));

  const matched = new Set<string>();
  const changes: RevisionChange[] = [];
  const scoredComps: CaptureCompetency[] = input.scored.competencies.map(sc => {
    const key = normalizeStatement(sc.statement);
    const base = baseByKey.get(key);
    const after = base ? { ...sc, statement: base.statement } : sc;
    if (base) matched.add(key);
    const dims = dimsBetween(base ?? null, after);
    if (base && dims.length === 0) return after;
    const newCitations = (after.citations ?? []).filter(isNewCitation);
    const label = newCitations.length > 0 ? 'new_evidence' : 'no_new_evidence';
    changes.push({
      statement: after.statement,
      kind: base ? 'moved' : 'added',
      label,
      dims,
      new_citations: newCitations,
      before: base ?? null,
      after,
      decision: mode === 'targeted' && label === 'no_new_evidence' ? 'undone' : 'pending',
    });
    return after;
  });
  for (const [key, base] of baseByKey) {
    if (matched.has(key)) continue;
    changes.push({
      statement: base.statement,
      kind: 'removed',
      label: 'no_new_evidence',
      dims: dimsBetween(base, null),
      new_citations: [],
      before: base,
      after: null,
      decision: mode === 'targeted' ? 'undone' : 'pending',
    });
  }

  let profile: CaptureProfile = rewriteReferences({ ...input.scored, competencies: scoredComps }, wording);
  // Lay out the competency array to match each change's starting decision.
  profile = { ...profile, revision: { mode, baseline_snapshot_id: input.baselineSnapshotId, changes, stale_evidence: [], changed_sections: [] } };
  for (const c of changes) profile = placeCompetency(profile, c, c.decision === 'undone' ? 'undone' : 'kept');

  const stale = profile.competencies
    .filter(c => (c.citations ?? []).some(isStaleCitation))
    .map(c => c.statement);
  const changedSections = REVISION_SECTIONS.flatMap(section => {
    const before = (baseline as Record<string, unknown>)[section] ?? null;
    const now = (profile as Record<string, unknown>)[section] ?? null;
    return JSON.stringify(before) === JSON.stringify(now) ? [] : [{ section, before }];
  });

  const unmatchedScored = changes.filter(c => c.kind === 'added').length;
  const unmatchedBaseline = changes.filter(c => c.kind === 'removed').length;
  const noEvidence = changes.filter(c => c.label === 'no_new_evidence').length;
  console.info(`[revision] ${profile.course_code}: ${mode} — ${changes.length} changes, ${noEvidence} without new evidence, unmatched scored ${unmatchedScored}, unmatched baseline ${unmatchedBaseline}`);

  return { ...profile, revision: { ...profile.revision!, stale_evidence: stale, changed_sections: changedSections } };
}

/** Put one change's `before` (undone) or `after` (kept) into the competency
 *  array: replace in place, insert at the end when absent, remove for null. */
function placeCompetency(profile: CaptureProfile, change: RevisionChange, side: 'kept' | 'undone'): CaptureProfile {
  const want = side === 'kept' ? change.after : change.before;
  const key = normalizeStatement(change.statement);
  const idx = profile.competencies.findIndex(c => normalizeStatement(c.statement) === key);
  const comps = [...profile.competencies];
  if (want === null) {
    if (idx >= 0) comps.splice(idx, 1);
  } else if (idx >= 0) {
    comps[idx] = want;
  } else {
    comps.push(want);
  }
  return { ...profile, competencies: comps };
}

/** Faculty decision on one change: `kept` shows the re-scored version, `undone`
 *  the approved one (replacing any hand edit to that competency). */
export function applyRevisionDecision(
  profile: CaptureProfile,
  statement: string,
  decision: 'kept' | 'undone',
): CaptureProfile {
  const revision = profile.revision;
  if (!revision) return profile;
  const change = revision.changes.find(c => c.statement === statement);
  if (!change) return profile;
  const placed = placeCompetency(profile, change, decision);
  const changes = revision.changes.map(c => (c === change ? { ...c, decision } : c));
  return { ...placed, revision: { ...revision, changes } as Revision };
}

/** Put a changed section back to the approved version. */
export function restoreSection(profile: CaptureProfile, section: string): CaptureProfile {
  const revision = profile.revision;
  const entry = revision?.changed_sections.find(s => s.section === section);
  if (!revision || !entry) return profile;
  return {
    ...profile,
    [section]: entry.before,
    revision: { ...revision, changed_sections: revision.changed_sections.filter(s => s !== entry) },
  } as CaptureProfile;
}

/** The profile as it may be frozen into a snapshot: no revision block. */
export function withoutRevision(profile: CaptureProfile): CaptureProfile {
  if (!('revision' in profile)) return profile;
  const rest = { ...profile };
  delete rest.revision;
  return rest;
}

/** What each working competency is compared with to detect a faculty upward
 *  override (upwardBumps, index-aligned with `working`). A competency with a
 *  revision change is compared with the version its decision selects (before
 *  when undone, otherwise after), so a Keep/Undo decision is never a raise;
 *  hand edits on top still are. Without a revision: the loaded competencies. */
export function overrideReference(loaded: CaptureProfile, working: CaptureProfile): CaptureCompetency[] {
  const revision = working.revision;
  if (!revision) return loaded.competencies;
  const loadedByKey = new Map(loaded.competencies.map(c => [normalizeStatement(c.statement), c]));
  const changeByKey = new Map(revision.changes.map(c => [normalizeStatement(c.statement), c]));
  return working.competencies.map(w => {
    const key = normalizeStatement(w.statement);
    const change = changeByKey.get(key);
    if (change) return (change.decision === 'undone' ? change.before : change.after) ?? w;
    return loadedByKey.get(key) ?? w;
  });
}
