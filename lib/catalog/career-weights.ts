/**
 * P3 career weights (spec docs/superpowers/specs/2026-10-21-p3-career-weights-design.md).
 * Pure: no DB, no I/O. Weight = how much a competency matters for a career.
 *   O*NET: per occupation, the highest Importance among confirmed counting
 *   items (core fully, related × RELATED_DISCOUNT, fringe never), summed by
 *   occupation share. Employer (Position Capture): see employerWeight.
 *   Effective: faculty override > blend (k·onet + n·employer)/(k + n) >
 *   onet > employer > faculty draft > none.
 */
export const RELATED_DISCOUNT = 0;
export const EMPLOYER_PRIOR_K = 3;
export const DISAGREEMENT_GAP = 0.25;
export const DISAGREEMENT_MIN_N = 2;

export type Position = 'core' | 'related' | 'fringe';
export interface WeightItem { position: Position; importanceBySoc: Record<string, number> }
export interface Occupation { soc: string; share: number }

export function rescaleImportance(im: number): number {
  return Math.min(1, Math.max(0, (im - 1) / 4));
}

function positionFactor(p: Position, relatedDiscount: number): number {
  return p === 'core' ? 1 : p === 'related' ? relatedDiscount : 0;
}

export function onetWeight(items: WeightItem[], occupations: Occupation[], relatedDiscount: number = RELATED_DISCOUNT): number | null {
  let counted = false;
  let total = 0;
  for (const o of occupations) {
    let best = 0;
    for (const it of items) {
      const f = positionFactor(it.position, relatedDiscount);
      if (f === 0) continue;
      const im = it.importanceBySoc[o.soc];
      if (im === undefined) continue;
      counted = true;
      best = Math.max(best, f * rescaleImportance(im));
    }
    total += o.share * best;
  }
  return counted ? Math.min(1, total) : null;
}

export interface WeightSources { onet: number | null; employer: number | null; n: number; facultyOverride: number | null; facultyDraft: number | null }
export type WeightBasis = 'faculty_override' | 'blend' | 'onet' | 'employer' | 'faculty_draft' | 'none';

export function effectiveWeight(s: WeightSources, k: number = EMPLOYER_PRIOR_K): { weight: number | null; basis: WeightBasis; disagreement: boolean } {
  const emp = s.n > 0 ? s.employer : null;
  const disagreement = s.onet !== null && emp !== null && s.n >= DISAGREEMENT_MIN_N && Math.abs(s.onet - emp) >= DISAGREEMENT_GAP;
  if (s.facultyOverride !== null) return { weight: s.facultyOverride, basis: 'faculty_override', disagreement };
  if (s.onet !== null && emp !== null) return { weight: (k * s.onet + s.n * emp) / (k + s.n), basis: 'blend', disagreement };
  if (s.onet !== null) return { weight: s.onet, basis: 'onet', disagreement };
  if (emp !== null) return { weight: emp, basis: 'employer', disagreement };
  if (s.facultyDraft !== null) return { weight: s.facultyDraft, basis: 'faculty_draft', disagreement };
  return { weight: null, basis: 'none', disagreement };
}
