// Where course cards sit on the curriculum map, and the teaching order that follows from it.
//
// A card's position is stored on its placement (x, y in map pixels from its lane's top left, at 100% zoom).
// Cards nobody has moved yet have no position, and layoutLanes() places them: in a lane with no moved cards,
// rows fill from the bottom up in teaching order; in a lane that has moved cards, the unmoved ones go in rows
// above them, as the latest. Opening a plan never writes positions; the first move in a lane fixes every card
// in that lane where it was shown.
//
// Teaching order is read from position: lower comes first, and at the same height, further left comes first.
// orderByPosition() rewrites the placements array to that order, so computePlan's order checks match the map.
import type { Act, Placement } from './types';

export const CARD_W = 168;   // a card's width on the map, in map pixels (set on the card, so it does not follow the root font size)
export const COL_W = 182;    // card plus gap, for the automatic layout
export const ROW_H = 84;     // a row in the automatic layout: tall enough for a card with its tag
export const PER_ROW = 6;    // cards per row in the automatic layout
/** Cards whose tops are within this many pixels count as the same height when reading order. */
export const ROW_SNAP = 24;

export interface Pos { x: number; y: number }

/** The lane a placement is drawn in. A branch that no longer exists falls back to the trunk, as in placeCourses. */
export function laneOf(p: Placement, branchIds: ReadonlySet<string>): string {
  const branch = p.branch && branchIds.has(p.branch) ? p.branch : null;
  return `${p.act}:${branch ?? ''}`;
}

const hasPos = (p: Placement): p is Placement & { x: number; y: number } =>
  typeof p.x === 'number' && typeof p.y === 'number';

/** Every placed card's position, by ref. Stored positions are kept; the rest are laid out as described above. */
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
    const moved = cards.filter(hasPos);
    const unmoved = cards.filter(p => !hasPos(p));
    const here: Record<string, Pos> = {};
    for (const p of moved) here[p.ref] = { x: p.x, y: p.y };
    if (moved.length === 0) {
      const rows = Math.ceil(unmoved.length / PER_ROW);
      unmoved.forEach((p, i) => {
        here[p.ref] = { x: (i % PER_ROW) * COL_W, y: (rows - 1 - Math.floor(i / PER_ROW)) * ROW_H };
      });
    } else {
      const top = Math.min(...moved.map(p => p.y));
      unmoved.forEach((p, i) => {
        here[p.ref] = { x: (i % PER_ROW) * COL_W, y: top - (Math.floor(i / PER_ROW) + 1) * ROW_H };
      });
      // Rows added above the top card can run past the lane's top edge: move the whole lane down to fit.
      const minY = Math.min(...Object.values(here).map(q => q.y));
      if (minY < 0) for (const q of Object.values(here)) q.y -= minY;
    }
    Object.assign(out, here);
  }
  return out;
}

/** The lane's content height: the lowest card's top plus a row. 0 for an empty lane. */
export function laneHeight(positions: readonly Pos[]): number {
  return positions.length === 0 ? 0 : Math.max(...positions.map(p => p.y)) + ROW_H;
}

/**
 * Teaching order from position, act by act: lower first (a larger y), then left first, then the order the
 * cards had. Each act keeps the array slots it had, so courses in other acts do not move in the array.
 */
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
        const ya = Math.round(pa.y / ROW_SNAP), yb = Math.round(pb.y / ROW_SNAP);
        return yb - ya || pa.x - pb.x || a.i - b.i;
      });
    slots.forEach((slot, k) => { out[slot] = sorted[k]!.p; });
  }
  return out;
}

/**
 * Move (or add) a card to a point in a lane. Every card in the lane it leaves and the lane it joins is fixed
 * where it was shown, so nothing else on screen jumps; then teaching order is rewritten from the positions.
 */
export function moveCard(
  placements: readonly Placement[], branchIds: ReadonlySet<string>,
  ref: string, act: Act, branch: string | null, at: Pos,
): Placement[] {
  const shown = layoutLanes(placements, branchIds);
  const before = placements.find(p => p.ref === ref);
  const target: Placement = { ref, act, branch: branch && branchIds.has(branch) ? branch : null, x: Math.max(0, Math.round(at.x)), y: Math.max(0, Math.round(at.y)) };
  const touched = new Set([laneOf(target, branchIds), ...(before ? [laneOf(before, branchIds)] : [])]);
  const rest = placements
    .filter(p => p.ref !== ref)
    .map(p => (touched.has(laneOf(p, branchIds)) && !hasPos(p) && shown[p.ref] ? { ...p, ...shown[p.ref] } : p));
  const next = [...rest, target];
  return orderByPosition(next, layoutLanes(next, branchIds));
}
