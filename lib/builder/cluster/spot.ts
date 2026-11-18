import { CARD_W } from '../layout';
import type { ClusterCard } from './state';

const GAP = 56;
const MARGIN = 40;
const MAX_COORD = 20000; // the schema's limit (lib/builder/cluster/state.ts)

/** Where a new card goes: right of the rightmost card, level with it; the top left on an empty canvas. */
export function nextCardSpot(cards: readonly ClusterCard[]): { x: number; y: number } {
  if (!cards.length) return { x: MARGIN, y: MARGIN };
  const right = cards.reduce((a, b) => (b.x > a.x ? b : a));
  return { x: Math.min(MAX_COORD - CARD_W, right.x + CARD_W + GAP), y: right.y };
}
