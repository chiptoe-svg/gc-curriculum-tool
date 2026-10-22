/**
 * Which competencies a career target shows (spec
 * docs/superpowers/specs/2026-10-21-p3-membership-from-weights-design.md).
 * Pure: no DB. Member = (pinned OR entry effective weight >= cutoff) AND NOT hidden.
 * Bands label weights in O*NET wording; their floors match the cutoff and the
 * /program slider stops.
 */
export const MEMBERSHIP_CUTOFF = 0.5;
export const LIST_FLOOR = 0.25;
/** pg_advisory_xact_lock key shared by every membership-changing write. */
export const MEMBERSHIP_LOCK_KEY = 2026102101;

export type Band = 'very' | 'important' | 'somewhat';
export const BAND_FLOORS: Record<Band, number> = { very: 0.75, important: 0.5, somewhat: 0.25 };
export const BAND_LABELS: Record<Band, string> = {
  very: 'Very or extremely important',
  important: 'Important',
  somewhat: 'Somewhat important',
};
export const PINNED_LABEL = 'Selected by faculty';

export function bandOf(weight: number | null): Band | null {
  if (weight === null) return null;
  if (weight >= BAND_FLOORS.very) return 'very';
  if (weight >= BAND_FLOORS.important) return 'important';
  if (weight >= BAND_FLOORS.somewhat) return 'somewhat';
  return null;
}

export interface PairState { careerTargetId: string; competencyId: string; pinned: boolean; hidden: boolean; pinOrder: number | null; weight: number | null }
export interface MembershipRow { careerTargetId: string; competencyId: string; basis: 'pinned' | 'weight'; effectiveWeight: number | null; displayOrder: number }

export function decideMembership(pairs: PairState[], cutoff: number = MEMBERSHIP_CUTOFF): MembershipRow[] {
  const byTarget = new Map<string, PairState[]>();
  for (const s of pairs) {
    const a = byTarget.get(s.careerTargetId);
    if (a) a.push(s); else byTarget.set(s.careerTargetId, [s]);
  }
  const out: MembershipRow[] = [];
  for (const t of [...byTarget.keys()].sort()) {
    const ps = byTarget.get(t)!.filter(s => !s.hidden);
    const pins = ps.filter(s => s.pinned).sort((a, b) => (a.pinOrder ?? 0) - (b.pinOrder ?? 0) || a.competencyId.localeCompare(b.competencyId));
    const weighted = ps.filter(s => !s.pinned && s.weight !== null && s.weight >= cutoff)
      .sort((a, b) => b.weight! - a.weight! || a.competencyId.localeCompare(b.competencyId));
    let next = pins.length ? Math.max(...pins.map(s => s.pinOrder ?? 0)) + 1 : 0;
    for (const s of pins) out.push({ careerTargetId: t, competencyId: s.competencyId, basis: 'pinned', effectiveWeight: s.weight, displayOrder: s.pinOrder ?? 0 });
    for (const s of weighted) out.push({ careerTargetId: t, competencyId: s.competencyId, basis: 'weight', effectiveWeight: s.weight, displayOrder: next++ });
  }
  return out;
}
