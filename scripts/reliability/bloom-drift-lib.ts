/**
 * Pure comparison for the Bloom-language drift check
 * (plan docs/superpowers/plans/2026-11-25-bloom-language-skill.md, Task 5).
 *
 * Compares K/U/D levels from capture-scores runs on the old prompt against runs on the new
 * one. Per (course, dimension) it takes the MEAN level of a run (null K/U, foundational, is
 * skipped). Profiles carry no stable competency id and technical statements are re-worded
 * every run, so cells are not matched one to one (ledger ruling, Task 5).
 */

export type Dim = 'k' | 'u' | 'd';
export interface DriftCell { competency: string; k: number | null; u: number | null; d: number | null }
export interface DriftRun { course: string; run: number; label: string; cells: DriftCell[]; statements: string[] }
export interface DriftReport {
  withinNoise: Record<Dim, number>;
  between: Record<Dim, number>;
  meanShift: Record<Dim, number>;
  bloomShare: { old: number; new: number };
  /** How much was compared; a report over zero courses is not evidence of anything. */
  compared: { oldRuns: number; newRuns: number; courses: number };
}

const DIMS: Dim[] = ['k', 'u', 'd'];

/** Krathwohl (2002), Table 3: the revised taxonomy's 19 cognitive processes. */
export const BLOOM_PROCESSES = [
  'recognizing', 'recalling', 'interpreting', 'exemplifying', 'classifying', 'summarizing', 'inferring',
  'comparing', 'explaining', 'executing', 'implementing', 'differentiating', 'organizing', 'attributing',
  'checking', 'critiquing', 'generating', 'planning', 'producing',
];
// Whole verb forms only, so "recall", "explains", "critiqued" count but look-alike nouns
// ("production", "checklist", "planographic", "organization", "generation") do not.
const VERB_FORMS = [
  'recogni(?:ze|zes|zed|zing)', 'recall(?:s|ed|ing)?', 'interpret(?:s|ed|ing)?', 'exemplif(?:y|ies|ied|ying)',
  'classif(?:y|ies|ied|ying)', 'summariz(?:e|es|ed|ing)', 'infer(?:s|red|ring)?', 'compar(?:e|es|ed|ing)',
  'explain(?:s|ed|ing)?', 'execut(?:e|es|ed|ing)', 'implement(?:s|ed|ing)?', 'differentiat(?:e|es|ed|ing)',
  'organiz(?:e|es|ed|ing)', 'attribut(?:e|es|ed|ing)', 'check(?:s|ed|ing)?', 'critiqu(?:e|es|ed|ing)',
  'generat(?:e|es|ed|ing)', 'plan(?:s|ned|ning)?', 'produc(?:e|es|ed|ing)',
];
const BLOOM_RE = new RegExp(`\\b(?:${VERB_FORMS.join('|')})\\b`, 'i');

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function runMean(run: DriftRun, dim: Dim): number | null {
  const vals = run.cells.map(c => c[dim]).filter((v): v is number => v != null);
  return vals.length ? mean(vals) : null;
}

function byCourse(runs: DriftRun[]): Map<string, DriftRun[]> {
  const m = new Map<string, DriftRun[]>();
  for (const r of runs) m.set(r.course, [...(m.get(r.course) ?? []), r]);
  return m;
}

/** Mean |a − b| over every pair drawn from xs × ys (or distinct pairs within xs when ys is null). */
function pairDiffs(xs: number[], ys: number[] | null): number[] {
  const out: number[] = [];
  if (ys) for (const x of xs) for (const y of ys) out.push(Math.abs(x - y));
  else for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) out.push(Math.abs(xs[i]! - xs[j]!));
  return out;
}

/**
 * Paid-run ceiling (owner rule 2026-11-08): before EVERY paid call, refuse once spend has
 * reached the cap, or if the largest call seen so far would cross it. A null cap = free run.
 */
export function mayCall(spentUsd: number, maxUsd: number | null, largestCallUsd: number): boolean {
  if (maxUsd === null) return true;
  return spentUsd < maxUsd && spentUsd + largestCallUsd <= maxUsd;
}

export function bloomShare(runs: DriftRun[]): number {
  const s = runs.flatMap(r => r.statements);
  return s.length ? s.filter(x => BLOOM_RE.test(x)).length / s.length : 0;
}

export function compareRuns(oldRuns: DriftRun[], newRuns: DriftRun[]): DriftReport {
  const A = byCourse(oldRuns), B = byCourse(newRuns);
  const courses = [...A.keys()].filter(c => B.has(c));
  const withinNoise = {} as Record<Dim, number>, between = {} as Record<Dim, number>, meanShift = {} as Record<Dim, number>;
  for (const dim of DIMS) {
    const within: number[] = [], betw: number[] = [], shift: number[] = [];
    for (const c of courses) {
      const a = A.get(c)!.map(r => runMean(r, dim)).filter((v): v is number => v != null);
      const b = B.get(c)!.map(r => runMean(r, dim)).filter((v): v is number => v != null);
      within.push(...pairDiffs(a, null), ...pairDiffs(b, null));
      betw.push(...pairDiffs(a, b));
      if (a.length && b.length) shift.push(mean(b) - mean(a));
    }
    withinNoise[dim] = r3(mean(within));
    between[dim] = r3(mean(betw));
    meanShift[dim] = r3(mean(shift));
  }
  return {
    withinNoise, between, meanShift,
    bloomShare: { old: r3(bloomShare(oldRuns)), new: r3(bloomShare(newRuns)) },
    compared: {
      oldRuns: courses.reduce((n, c) => n + A.get(c)!.length, 0),
      newRuns: courses.reduce((n, c) => n + B.get(c)!.length, 0),
      courses: courses.length,
    },
  };
}
