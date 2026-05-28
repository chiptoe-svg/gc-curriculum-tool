/**
 * Phase 1B Scaffolding Analysis — deterministic scoring primitives.
 *
 * Spec: docs/superpowers/specs/2026-05-25-scaffolding-analysis-design.md
 *
 * All functions are pure. Inputs are loaded by lib/db/scaffolding-queries.ts
 * and passed in; nothing here reaches into the DB.
 */

export type PfConditionValue = 'present' | 'partial' | 'absent';

export interface ProductiveFailureConditions {
  generate_then_consolidate: PfConditionValue;
  open_ended_problems: PfConditionValue;
  revision_cycles: PfConditionValue;
  structured_post_mortem: PfConditionValue;
  max_supporting_depth: number;
  notes: string[];
}

/**
 * One snapshot's contribution toward a single sub-competency. `sequenceIndex`
 * is the course's position in program order (catalog-level / prerequisite
 * chain). `productiveFailureConditions` is null when Audit Area 7 wasn't
 * probed (pre-2026-05-25 snapshots, or v2 captures that elected to skip it).
 */
export interface SnapshotCellInput {
  snapshotId: string;
  courseCode: string;
  sequenceIndex: number;
  kDepth: number | null;
  uDepth: number | null;
  dDepth: number;
  productiveFailureConditions: ProductiveFailureConditions | null;
}

// ---------------------------------------------------------------------------
// Primitive 2 — Productive-failure scoring (continuous, depth-weighted)
// ---------------------------------------------------------------------------

const PF_FIELDS: Array<keyof Pick<ProductiveFailureConditions,
  'generate_then_consolidate' | 'open_ended_problems' | 'revision_cycles' | 'structured_post_mortem'
>> = [
  'generate_then_consolidate',
  'open_ended_problems',
  'revision_cycles',
  'structured_post_mortem',
];

function conditionWeight(v: PfConditionValue): number {
  return v === 'present' ? 1.0 : v === 'partial' ? 0.5 : 0.0;
}

/**
 * 0–1: fraction of the four conditions present (with partials at 0.5 weight).
 * Null/undefined PF blocks score 0 (no data).
 */
export function conditionsScore(pf: ProductiveFailureConditions | null): number {
  if (!pf) return 0;
  const sum = PF_FIELDS.reduce((acc, k) => acc + conditionWeight(pf[k]), 0);
  return sum / PF_FIELDS.length;
}

/**
 * 0–1: how much this depth contributes per the spec's non-linear ramp.
 * D=0→0.0, D=1→0.15, D=2→0.35, D=3→0.60, D=4→0.85, D=5→1.0.
 * Out-of-range inputs clamp.
 */
export function depthWeight(d: number): number {
  const ramp = [0.0, 0.15, 0.35, 0.60, 0.85, 1.0];
  if (d < 0) return 0.0;
  if (d >= ramp.length) return 1.0;
  return ramp[Math.floor(d)]!;
}

/**
 * 0.5–1.0: reflection multiplier per the spec. Asymmetric because reflection
 * is the mechanism that converts struggle into transfer; a course without
 * structured post-mortem contributes at half-effectiveness.
 */
export function reflectionWeight(v: PfConditionValue): number {
  return v === 'present' ? 1.0 : v === 'partial' ? 0.75 : 0.5;
}

/**
 * Per-snapshot productive-failure contribution to one sub-competency.
 * snapshot_contribution = conditions_score × depth_weight × reflection_weight
 */
export function snapshotPfContribution(cell: SnapshotCellInput): number {
  const cs = conditionsScore(cell.productiveFailureConditions);
  const dw = depthWeight(cell.dDepth);
  const rw = reflectionWeight(cell.productiveFailureConditions?.structured_post_mortem ?? 'absent');
  return cs * dw * rw;
}

export type PfStatus = 'well_developed' | 'developing' | 'thin' | 'absent';

/**
 * Map a cumulative PF score to a band. `well_developed` requires both the
 * threshold AND at least one contributor at D≥4 — otherwise large cumulative
 * scores from many low-depth contributors cap at `developing` (it isn't the
 * same thing as integration-level PF).
 */
export function cumulativePfStatus(cumulative: number, hasUpperDepthContributor: boolean): PfStatus {
  if (cumulative >= 1.5 && hasUpperDepthContributor) return 'well_developed';
  if (cumulative >= 0.5) return 'developing';
  if (cumulative >= 0.1) return 'thin';
  return 'absent';
}

// ---------------------------------------------------------------------------
// Primitive 1 — Depth-sequence scaffolding
// ---------------------------------------------------------------------------

export type ScaffoldingStatus =
  | 'well_scaffolded'
  | 'top_heavy'
  | 'bottom_heavy'
  | 'coverage_only'
  | 'brittle_scaffold'
  | 'not_addressed';

export interface DepthPhasesPresent {
  introduction: boolean;
  practice: boolean;
  integration: boolean;
}

export interface DepthScaffoldingResult {
  phases: DepthPhasesPresent;
  status: ScaffoldingStatus;
}

// Phase thresholds per spec §"Primitive 1":
//   introduction: K=1–2 or U=1–2
//   practice:     K=3–4 or U=2–3 or D=2–3 (D=2-3 only when K≥3 or U≥2, so shallow-knowledge
//                 cells with D=2 at K≤2/U≤1 remain "coverage" rather than practice)
//   integration:  U=4–5 or D=4–5 (integration supersedes practice for phase assignment)
function isIntroduction(c: SnapshotCellInput): boolean {
  return (c.kDepth !== null && c.kDepth >= 1 && c.kDepth <= 2)
    || (c.uDepth !== null && c.uDepth >= 1 && c.uDepth <= 2);
}
function isPractice(c: SnapshotCellInput): boolean {
  if (isIntegration(c)) return false; // integration supersedes practice
  const kPractice = c.kDepth !== null && c.kDepth >= 3 && c.kDepth <= 4;
  const uPractice = c.uDepth !== null && c.uDepth >= 2 && c.uDepth <= 3;
  // D=2-3 counts as practice only when K or U signals the knowledge base is ready
  const dPractice = c.dDepth >= 2 && c.dDepth <= 3
    && ((c.kDepth !== null && c.kDepth >= 3) || (c.uDepth !== null && c.uDepth >= 2));
  return kPractice || uPractice || dPractice;
}
function isIntegration(c: SnapshotCellInput): boolean {
  return (c.uDepth !== null && c.uDepth >= 4) || c.dDepth >= 4;
}

/**
 * Determine the depth-scaffolding status across the contributing snapshots
 * for one sub-competency. Cells should be passed in program-sequence order
 * (sequenceIndex ascending); the function double-checks for safety.
 */
export function depthScaffoldingStatus(cells: SnapshotCellInput[]): DepthScaffoldingResult {
  const ordered = [...cells].sort((a, b) => a.sequenceIndex - b.sequenceIndex);

  const phases: DepthPhasesPresent = {
    introduction: ordered.some(isIntroduction),
    practice: ordered.some(isPractice),
    integration: ordered.some(isIntegration),
  };

  // Nothing reaches even K=1 / U=1 / D=1 → not addressed.
  const anyAboveZero = ordered.some(c =>
    (c.kDepth ?? 0) >= 1 || (c.uDepth ?? 0) >= 1 || c.dDepth >= 1,
  );
  if (!anyAboveZero) {
    return { phases, status: 'not_addressed' };
  }

  // Brittle: integration appears in the course sequence before any
  // introduction OR practice cell — the upper-division course expects
  // mastery of something never set up.
  const firstIntegrationIdx = ordered.findIndex(isIntegration);
  const firstIntroIdx = ordered.findIndex(isIntroduction);
  const firstPracticeIdx = ordered.findIndex(isPractice);
  if (firstIntegrationIdx !== -1) {
    const introBefore = firstIntroIdx !== -1 && firstIntroIdx < firstIntegrationIdx;
    const practiceBefore = firstPracticeIdx !== -1 && firstPracticeIdx < firstIntegrationIdx;
    if (!introBefore && !practiceBefore) {
      return { phases, status: 'brittle_scaffold' };
    }
  }

  if (phases.introduction && phases.practice && phases.integration) {
    return { phases, status: 'well_scaffolded' };
  }
  if (phases.introduction && phases.integration && !phases.practice) {
    return { phases, status: 'top_heavy' };
  }
  if (phases.introduction && phases.practice && !phases.integration) {
    return { phases, status: 'bottom_heavy' };
  }
  // Only introduction (possibly stacked across multiple courses).
  return { phases, status: 'coverage_only' };
}

// ---------------------------------------------------------------------------
// Aggregate
// ---------------------------------------------------------------------------

export interface SubCompetencyScaffolding {
  subCompetencyId: string;
  subCompetencyName: string;
  cells: SnapshotCellInput[];
  scaffolding: DepthScaffoldingResult;
  cumulativePfScore: number;
  pfStatus: PfStatus;
}

export function aggregateSubCompetency(
  subCompetencyId: string,
  subCompetencyName: string,
  cells: SnapshotCellInput[],
): SubCompetencyScaffolding {
  const scaffolding = depthScaffoldingStatus(cells);
  const cumulative = cells.reduce((acc, c) => acc + snapshotPfContribution(c), 0);
  const hasUpper = cells.some(c => c.dDepth >= 4);
  const pfStatus = cumulativePfStatus(cumulative, hasUpper);
  return {
    subCompetencyId,
    subCompetencyName,
    cells,
    scaffolding,
    cumulativePfScore: cumulative,
    pfStatus,
  };
}
