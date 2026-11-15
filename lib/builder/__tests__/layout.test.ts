import { describe, expect, it } from 'vitest';
import { CARD_W, COL_W, layoutLanes, moveCard, orderByPosition, slotAt } from '../layout';
import { EMPTY_PLAN, termOf, type Placement } from '../types';
import { parsePlanState } from '../plan-schema';

const none = new Set<string>();
const p = (ref: string, act: 1 | 2 | 3 = 1, extra: Partial<Placement> = {}): Placement => ({ ref, act, branch: null, ...extra });
const refs = (ps: Placement[]) => ps.map(x => x.ref);

describe('terms', () => {
  it('numbers the nine terms from the bottom of Act 1', () => {
    expect(termOf(1, 0)).toBe(1);
    expect(termOf(2, 1)).toBe(5);
    expect(termOf(3, 2)).toBe(9);
  });
  it('reads the top row of a lane as the act\'s last term', () => {
    expect(slotAt(5, 300)).toBe(2);
    expect(slotAt(150, 300)).toBe(1);
    expect(slotAt(299, 300)).toBe(0);
    expect(slotAt(-40, 300)).toBe(2);
    expect(slotAt(900, 300)).toBe(0);
  });
});

describe('layoutLanes', () => {
  it('spreads cards nobody has moved over the three terms, in teaching order, left to right within a term', () => {
    const pos = layoutLanes([p('a'), p('b'), p('c'), p('d'), p('e'), p('f')], none);
    expect(pos.a).toEqual({ slot: 0, x: 0 });
    expect(pos.b).toEqual({ slot: 0, x: COL_W });
    expect(pos.c).toEqual({ slot: 1, x: 0 });
    expect(pos.f).toEqual({ slot: 2, x: COL_W });
  });

  it('keeps stored positions and puts an unmoved card in the last term, after what is there', () => {
    const pos = layoutLanes([p('a', 1, { slot: 2, x: 300 }), p('b')], none);
    expect(pos.a).toEqual({ slot: 2, x: 300 });
    expect(pos.b!.slot).toBe(2);
    expect(pos.b!.x).toBeGreaterThanOrEqual(300 + CARD_W);
  });

  it('lays out each act and branch separately; a deleted branch falls back to the trunk', () => {
    const pos = layoutLanes([p('a'), p('b', 2), { ...p('c'), branch: 'gone' }], none);
    expect(pos.b).toEqual({ slot: 0, x: 0 });
    expect([pos.a!.slot, pos.c!.slot]).toEqual([0, 1]); // a and c share Act 1's trunk lane
  });
});

describe('orderByPosition', () => {
  it('reads an earlier term as earlier, then left as earlier, within each act', () => {
    const ps = [p('late'), p('early-right'), p('early-left')];
    const pos = { late: { slot: 2 as const, x: 0 }, 'early-right': { slot: 0 as const, x: 400 }, 'early-left': { slot: 0 as const, x: 0 } };
    expect(refs(orderByPosition(ps, pos))).toEqual(['early-left', 'early-right', 'late']);
  });

  it('leaves other acts in their array slots', () => {
    const ps = [p('a1'), p('b2', 2), p('c1')];
    const pos = { a1: { slot: 1 as const, x: 0 }, b2: { slot: 0 as const, x: 0 }, c1: { slot: 0 as const, x: 0 } };
    expect(refs(orderByPosition(ps, pos))).toEqual(['c1', 'b2', 'a1']);
  });

  it('does not change the order of a plan whose cards were never moved', () => {
    const ps = Array.from({ length: 16 }, (_, i) => p(`c${i}`, ((i % 3) + 1) as 1 | 2 | 3));
    expect(refs(orderByPosition(ps, layoutLanes(ps, none)))).toEqual(refs(ps));
  });
});

describe('moveCard', () => {
  it('moves a card to a later term; the other cards in the lane are fixed where they were shown', () => {
    const ps = [p('a'), p('b'), p('c')]; // one card per term
    const shown = layoutLanes(ps, none);
    const next = moveCard(ps, none, 'a', 1, null, { slot: 2, x: 500 });
    expect(next.find(x => x.ref === 'b')).toEqual({ ...p('b'), ...shown.b! });
    expect(refs(next)).toEqual(['b', 'c', 'a']);
  });

  it('moves a card to another act, rounding and clamping its place', () => {
    const next = moveCard([p('a'), p('c', 2)], none, 'a', 2, null, { slot: 0, x: -5.4 });
    expect(next.find(x => x.ref === 'a')).toEqual({ ref: 'a', act: 2, branch: null, slot: 0, x: 0 });
  });

  it('adds a card that was not on the map', () => {
    const next = moveCard([p('a')], none, 'new', 1, null, { slot: 0, x: 400 });
    expect(refs(next)).toEqual(['a', 'new']); // same term as a, further right
  });
});

describe('plan schema: term rows and heights', () => {
  it('accepts a plan saved before positions existed, and one with them', () => {
    expect(parsePlanState(EMPTY_PLAN)).toEqual(EMPTY_PLAN);
    const withPos = { ...EMPTY_PLAN, placements: [p('a', 1, { slot: 2, x: 12 })], heights: [null, 400, null] };
    expect(parsePlanState(withPos)).toEqual(withPos);
  });

  it('drops a vertical position saved by the earlier free layout, and refuses bad values', () => {
    expect(parsePlanState({ ...EMPTY_PLAN, placements: [{ ...p('a'), x: 10, y: 40 }] })!.placements[0]).toEqual({ ...p('a'), x: 10 });
    expect(parsePlanState({ ...EMPTY_PLAN, placements: [p('a', 1, { slot: 3 as never })] })).toBeNull();
    expect(parsePlanState({ ...EMPTY_PLAN, placements: [p('a', 1, { x: -1 })] })).toBeNull();
    expect(parsePlanState({ ...EMPTY_PLAN, heights: [10, null, null] })).toBeNull();
  });
});
