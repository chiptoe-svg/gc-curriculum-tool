/**
 * Pure flag matching + drift logic (no DB). The UIs use these to render
 * ⚑ markers; the GET /api/flags route uses flagDrift to annotate each open
 * cell flag with how the live score moved since it was flagged.
 * Design: docs/superpowers/specs/2026-06-12-faculty-flag-mechanism-design.md
 */

export interface FlagLike {
  id: string;
  targetKind: 'coverage_cell' | 'profile_competency';
  courseCode: string;
  careerTargetId: string | null;
  subCompetencyId: string | null;
  competencyStatement: string | null;
  status: 'open' | 'resolved';
  flaggedContext: { k: number | null; u: number | null; d: number | null } | null;
}

export interface DriftEntry {
  dim: 'k' | 'u' | 'd';
  was: number | null;
  now: number | null;
}

/** Open flags matching one matrix cell's stable identity. */
export function openFlagsForCell<T extends FlagLike>(
  flags: T[],
  courseCode: string,
  careerTargetId: string,
  subCompetencyId: string,
): T[] {
  return flags.filter(f =>
    f.status === 'open'
    && f.targetKind === 'coverage_cell'
    && f.courseCode === courseCode
    && f.careerTargetId === careerTargetId
    && f.subCompetencyId === subCompetencyId,
  );
}

/** Open flags matching one profile competency by exact statement. */
export function openFlagsForStatement<T extends FlagLike>(
  flags: T[],
  courseCode: string,
  statement: string,
): T[] {
  return flags.filter(f =>
    f.status === 'open'
    && f.targetKind === 'profile_competency'
    && f.courseCode === courseCode
    && f.competencyStatement === statement,
  );
}

/**
 * Per-dimension deltas between the reading as flagged and the live reading.
 * Null when either side is missing (annotate "(no longer in matrix)" /
 * "(context not recorded)" upstream) or when nothing moved.
 */
export function flagDrift(
  flagged: { k: number | null; u: number | null; d: number | null } | null,
  current: { k: number | null; u: number | null; d: number | null } | null,
): DriftEntry[] | null {
  if (!flagged || !current) return null;
  const out: DriftEntry[] = [];
  for (const dim of ['k', 'u', 'd'] as const) {
    if (flagged[dim] !== current[dim]) out.push({ dim, was: flagged[dim], now: current[dim] });
  }
  return out.length === 0 ? null : out;
}
