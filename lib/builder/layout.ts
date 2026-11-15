// Where course cards sit on the curriculum map, and the teaching order that follows from it.
//
// Each act has three term rows (TERMS_PER_ACT); a card snaps to one of them and moves freely left to right.
// A card's place is stored on its placement: `slot` (the term within the act) and `x` (map pixels from the
// lane's left edge, at 100% zoom). Cards nobody has moved have neither, and layoutLanes() places them: in a
// lane with no moved cards, the cards are spread over the act's three terms in teaching order; in a lane that
// has moved cards, an unmoved card goes in the act's last term, after what is there. Opening a plan never
// writes positions; the first move in a lane fixes every card in that lane where it was shown.
//
// Teaching order is read from position: an earlier term first, and within a term, further left first.
// orderByPosition() rewrites the placements array to that order, so computePlan's order checks match the map.
import { TERMS_PER_ACT, type Act, type Placement, type Slot } from './types';

/** Every card is the same size, in map pixels (set on the card, so it does not follow the root font size). */
export const CARD_W = 176;
export const CARD_H = 50;
export const COL_W = 190;    // card plus gap, for the automatic layout
export const ROW_H = 64;     // the least height of one term row

export interface Pos { slot: Slot; x: number }

/** The lane a placement is drawn in. A branch that no longer exists falls back to the trunk, as in placeCourses. */
export function laneOf(p: Placement, branchIds: ReadonlySet<string>): string {
  const branch = p.branch && branchIds.has(p.branch) ? p.branch : null;
  return `${p.act}:${branch ?? ''}`;
}

const placed = (p: Placement): p is Placement & Pos => p.slot != null && typeof p.x === 'number';

/** Every placed card's term row and left edge, by ref. Stored positions are kept; the rest are laid out as described above. */
export function layoutLanes(placements: readonly Placement[], branchIds: ReadonlySet<string>): Record<string, Pos> {
  const lanes = new Map<string, Placement[]>();
  const seen = new Set<string>();
  for (const p of placements) {
    if (seen.has(p.ref)) continue; // a ref placed twice is drawn once, as in placeCourses
    seen.add(p.ref);
    const k = laneOf(p, branchIds);
    lanes.set(k, [...(lanes.get(k) ?? []), p]);
  }
  const out: Record<string, Pos> = {};
  for (const cards of lanes.values()) {
    const moved = cards.filter(placed);
    const unmoved = cards.filter(p => !placed(p));
    for (const p of moved) out[p.ref] = { slot: p.slot, x: p.x };
    // The next free column in each term row, after the cards already there.
    const next = [0, 0, 0];
    for (const p of moved) next[p.slot] = Math.max(next[p.slot]!, Math.ceil((p.x + CARD_W) / COL_W) * COL_W);
    unmoved.forEach((p, i) => {
      const slot = (moved.length === 0 ? Math.floor((i * TERMS_PER_ACT) / unmoved.length) : TERMS_PER_ACT - 1) as Slot;
      out[p.ref] = { slot, x: next[slot]! };
      next[slot] = next[slot]! + COL_W;
    });
  }
  return out;
}

/** Teaching order within each act: earlier term first, then left first, then the order the cards had. Each act keeps its array slots. */
export function orderByPosition(placements: readonly Placement[], pos: Readonly<Record<string, Pos>>): Placement[] {
  const out = [...placements];
  for (const act of [1, 2, 3] as const) {
    const slots: number[] = [];
    out.forEach((p, i) => { if (p.act === act) slots.push(i); });
    const sorted = slots
      .map(i => ({ p: out[i]!, i }))
      .sort((a, b) => {
        const pa = pos[a.p.ref], pb = pos[b.p.ref];
        if (!pa || !pb) return a.i - b.i;
        return pa.slot - pb.slot || pa.x - pb.x || a.i - b.i;
      });
    slots.forEach((slot, k) => { out[slot] = sorted[k]!.p; });
  }
  return out;
}

/**
 * Move (or add) a card to a term row and a left edge in a lane. Every card in the lane it leaves and the lane
 * it joins is fixed where it was shown, so nothing else on screen jumps; then teaching order is rewritten.
 */
export function moveCard(
  placements: readonly Placement[], branchIds: ReadonlySet<string>,
  ref: string, act: Act, branch: string | null, at: Pos,
): Placement[] {
  const shown = layoutLanes(placements, branchIds);
  const before = placements.find(p => p.ref === ref);
  const target: Placement = {
    ref, act, branch: branch && branchIds.has(branch) ? branch : null,
    slot: Math.min(TERMS_PER_ACT - 1, Math.max(0, Math.round(at.slot))) as Slot, x: Math.max(0, Math.round(at.x)),
  };
  const touched = new Set([laneOf(target, branchIds), ...(before ? [laneOf(before, branchIds)] : [])]);
  const rest = placements
    .filter(p => p.ref !== ref)
    .map(p => (touched.has(laneOf(p, branchIds)) && !placed(p) && shown[p.ref] ? { ...p, ...shown[p.ref] } : p));
  const next = [...rest, target];
  return orderByPosition(next, layoutLanes(next, branchIds));
}

/** The term row a point falls in, from the top of a lane's card area of the given height (the top row is the act's last term). */
export function slotAt(y: number, height: number): Slot {
  const row = Math.min(TERMS_PER_ACT - 1, Math.max(0, Math.floor((y / Math.max(1, height)) * TERMS_PER_ACT)));
  return (TERMS_PER_ACT - 1 - row) as Slot;
}
