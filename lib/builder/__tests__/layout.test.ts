import { describe, expect, it } from 'vitest';
import { COL_W, PER_ROW, ROW_H, laneHeight, layoutLanes, moveCard, orderByPosition } from '../layout';
import { EMPTY_PLAN, type Placement } from '../types';
import { parsePlanState } from '../plan-schema';

const none = new Set<string>();
const p = (ref: string, act: 1 | 2 | 3 = 1, extra: Partial<Placement> = {}): Placement => ({ ref, act, branch: null, ...extra });
const refs = (ps: Placement[]) => ps.map(x => x.ref);

describe('layoutLanes', () => {
  it('fills rows from the bottom up, in teaching order, when no card has been moved', () => {
    const ps = Array.from({ length: PER_ROW + 2 }, (_, i) => p(`c${i}`));
    const pos = layoutLanes(ps, none);
    // Two rows: the first PER_ROW cards on the bottom row (y = ROW_H), the rest above them (y = 0).
    expect(pos.c0).toEqual({ x: 0, y: ROW_H });
    expect(pos[`c${PER_ROW - 1}`]).toEqual({ x: (PER_ROW - 1) * COL_W, y: ROW_H });
    expect(pos[`c${PER_ROW}`]).toEqual({ x: 0, y: 0 });
  });

  it('keeps stored positions and puts unmoved cards above the moved ones, shifting the lane down to fit', () => {
    const pos = layoutLanes([p('a', 1, { x: 300, y: 10 }), p('b')], none);
    expect(pos.b!.y).toBeLessThan(pos.a!.y);
    expect(pos.b!.y).toBe(0);
    // b was placed a row above a (10 - ROW_H, past the top), so the lane moved down by ROW_H - 10.
    expect(pos.a).toEqual({ x: 300, y: ROW_H });
  });

  it('lays out each act and branch separately; a deleted branch falls back to the trunk', () => {
    const ps = [p('a'), p('b', 2), { ...p('c'), branch: 'gone' }];
    const pos = layoutLanes(ps, none);
    expect(pos.a).toEqual({ x: 0, y: 0 });
    expect(pos.b).toEqual({ x: 0, y: 0 });
    expect(pos.c).toEqual({ x: COL_W, y: 0 }); // shares the trunk lane of Act 1 with a
  });
});

describe('orderByPosition', () => {
  it('reads lower as earlier, then left as earlier, within each act', () => {
    const ps = [p('top', 1), p('low-right', 1), p('low-left', 1)];
    const pos = { top: { x: 0, y: 0 }, 'low-right': { x: 400, y: 200 }, 'low-left': { x: 0, y: 205 } };
    expect(refs(orderByPosition(ps, pos))).toEqual(['low-left', 'low-right', 'top']);
  });

  it('leaves other acts in their array slots', () => {
    const ps = [p('a1', 1), p('b2', 2), p('c1', 1)];
    const pos = { a1: { x: 0, y: 0 }, b2: { x: 0, y: 0 }, c1: { x: 0, y: 300 } };
    expect(refs(orderByPosition(ps, pos))).toEqual(['c1', 'b2', 'a1']);
  });

  it('does not change the order of a plan whose cards were never moved', () => {
    const ps = Array.from({ length: 15 }, (_, i) => p(`c${i}`, ((i % 3) + 1) as 1 | 2 | 3));
    expect(refs(orderByPosition(ps, layoutLanes(ps, none)))).toEqual(refs(ps));
  });
});

describe('moveCard', () => {
  it('moving a card higher makes it later; every card in the lane is then fixed where it was shown', () => {
    const ps = [p('a'), p('b'), p('c')]; // one row: a, b, c left to right at y = 0
    const shown = layoutLanes(ps, none);
    const right = moveCard(ps, none, 'a', 1, null, { x: 500, y: 0 });
    expect(right.find(x => x.ref === 'b')).toEqual({ ...p('b'), ...shown.b! }); // fixed where it was shown
    expect(refs(right)).toEqual(['b', 'c', 'a']); // same height as b and c, but further right
    const above = moveCard([p('a', 1, { x: 0, y: 100 }), p('b', 1, { x: 200, y: 100 })], none, 'a', 1, null, { x: 0, y: 0 });
    expect(refs(above)).toEqual(['b', 'a']);
  });

  it('moves a card to another act and keeps the cards of the act it left where they were', () => {
    const ps = [p('a'), p('b'), p('c', 2)];
    const shown = layoutLanes(ps, none);
    const next = moveCard(ps, none, 'a', 2, null, { x: 10.4, y: -5 });
    expect(next.find(x => x.ref === 'a')).toEqual({ ref: 'a', act: 2, branch: null, x: 10, y: 0 });
    expect(next.find(x => x.ref === 'b')).toMatchObject(shown.b!);
  });

  it('adds a card that was not on the map', () => {
    const next = moveCard([p('a')], none, 'new', 1, null, { x: 0, y: 400 });
    expect(refs(next)).toEqual(['new', 'a']); // lower than a, so earlier
  });
});

describe('laneHeight', () => {
  it('is the lowest top plus a row, or 0 for an empty lane', () => {
    expect(laneHeight([])).toBe(0);
    expect(laneHeight([{ x: 0, y: 10 }, { x: 0, y: 90 }])).toBe(90 + ROW_H);
  });
});

describe('plan schema: positions and heights', () => {
  it('accepts a plan saved before positions existed, and one with them', () => {
    expect(parsePlanState(EMPTY_PLAN)).toEqual(EMPTY_PLAN);
    const withPos = { ...EMPTY_PLAN, placements: [p('a', 1, { x: 12, y: 30 })], heights: [null, 400, null] };
    expect(parsePlanState(withPos)).toEqual(withPos);
  });

  it('refuses negative or absurd positions and heights', () => {
    expect(parsePlanState({ ...EMPTY_PLAN, placements: [p('a', 1, { x: -1, y: 0 })] })).toBeNull();
    expect(parsePlanState({ ...EMPTY_PLAN, placements: [p('a', 1, { x: 0, y: 1e9 })] })).toBeNull();
    expect(parsePlanState({ ...EMPTY_PLAN, heights: [10, null, null] })).toBeNull();
  });
});
