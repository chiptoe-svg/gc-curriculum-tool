/**
 * Pure-function tests for computeGapsFromInputs — the ordinal-MAX gap engine.
 *
 * Three MANDATORY invariant tests verify no-double-count:
 *   1. diamond     — two paths converge on the same sub-comp; MAX wins, result stable
 *   2. dup tag     — same sub-comp tagged on two edges; MAX wins, dedup is stable
 *   3. redundant   — direct + redundant direct edge, both deliver same depth; result stable
 *
 * These tests exercise the PURE inner function (no DB) so they are deterministic
 * and fast — no mocks, no fixtures, no env setup required.
 */

import { describe, it, expect } from 'vitest';
import {
  computeGapsFromInputs,
  type RelyEdge,
  type DeliveredAttainment,
  type SubCompetencyGap,
} from '@/lib/program/prereq-gaps';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function edge(
  prereqCourseCode: string,
  subCompetencyId: string,
  expectedK: number | null,
  expectedU: number | null,
  expectedD: number | null,
): RelyEdge {
  return { prereqCourseCode, subCompetencyId, expectedK, expectedU, expectedD };
}

function delivered(
  prereqCourseCode: string,
  subCompetencyId: string,
  k: number | null,
  u: number | null,
  d: number | null,
  basis: 'measured' | 'intended' = 'measured',
): DeliveredAttainment {
  return { prereqCourseCode, subCompetencyId, k, u, d, basis };
}

function gapFor(gaps: SubCompetencyGap[], subId: string): SubCompetencyGap {
  const g = gaps.find((x) => x.subCompetencyId === subId);
  if (!g) throw new Error(`No gap for subCompetencyId="${subId}"`);
  return g;
}

// ---------------------------------------------------------------------------
// Invariant 1: DIAMOND — two prereqs deliver the same sub-comp at different depths
//
// Focal F relies on sub-comp X via edges F→B and F→C.
// B delivers X@D2 (measured), C delivers X@D3 (measured). F needs X@D3.
// Expected: delivered=MAX(2,3)=3, gap=0, status=met.
//
// Adding a REDUNDANT direct edge F→A where A delivers X@D1 must NOT change the result.
// ---------------------------------------------------------------------------
describe('Invariant 1 — diamond: MAX aggregation, stable with redundant low-value prereq', () => {
  const baseEdges: RelyEdge[] = [
    edge('B', 'X', null, null, 3), // focal needs D3 from B
    edge('C', 'X', null, null, 3), // same need from C (tags same sub-comp)
  ];
  const baseDelivered: DeliveredAttainment[] = [
    delivered('B', 'X', null, null, 2), // B delivers D2
    delivered('C', 'X', null, null, 3), // C delivers D3
  ];

  it('MAX(2,3)=3 meets needed D3 → status met, gap zero', () => {
    const gaps = computeGapsFromInputs(baseEdges, baseDelivered);
    const g = gapFor(gaps, 'X');
    expect(g.delivered.d).toBe(3);
    expect(g.gap.d).toBe(0);
    expect(g.status).toBe('met');
    expect(g.basis).toBe('measured');
  });

  it('adding redundant edge F→A (A delivers X@D1) does NOT change result', () => {
    const edgesWithA: RelyEdge[] = [
      ...baseEdges,
      edge('A', 'X', null, null, 3), // redundant: A also tags X with same need
    ];
    const deliveredWithA: DeliveredAttainment[] = [
      ...baseDelivered,
      delivered('A', 'X', null, null, 1), // A delivers only D1
    ];

    const withA = computeGapsFromInputs(edgesWithA, deliveredWithA);
    const without = computeGapsFromInputs(baseEdges, baseDelivered);

    const gA = gapFor(withA, 'X');
    const gBase = gapFor(without, 'X');

    // delivered MAX must still be 3 (A's D1 cannot drag it down)
    expect(gA.delivered.d).toBe(3);
    expect(gA.gap.d).toBe(0);
    expect(gA.status).toBe('met');

    // byte-identical on the computed values (not on contributingPrereqs which may differ)
    expect(gA.delivered).toEqual(gBase.delivered);
    expect(gA.gap).toEqual(gBase.gap);
    expect(gA.status).toEqual(gBase.status);
    expect(gA.basis).toEqual(gBase.basis);
  });
});

// ---------------------------------------------------------------------------
// Invariant 2: DUPLICATE SKILL-TAG — same sub-comp on two edges; duplicate in input
//
// Two edges F→B and F→C both tag X. F needs X@{d:3}.
// B delivers X@d2, C delivers X@d3 → MAX=3, met.
// Result must be identical whether C's edge appears once or TWICE in the array.
// ---------------------------------------------------------------------------
describe('Invariant 2 — duplicate skill-tag: result stable whether edge duplicated in input', () => {
  const edges: RelyEdge[] = [
    edge('B', 'X', null, null, 3),
    edge('C', 'X', null, null, 3),
  ];
  const del: DeliveredAttainment[] = [
    delivered('B', 'X', null, null, 2),
    delivered('C', 'X', null, null, 3),
  ];

  it('base case: MAX=3, status met', () => {
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    expect(g.delivered.d).toBe(3);
    expect(g.gap.d).toBe(0);
    expect(g.status).toBe('met');
  });

  it('duplicating C\'s edge in the input array does not change delivered/gap/status', () => {
    const dupEdges: RelyEdge[] = [
      edge('B', 'X', null, null, 3),
      edge('C', 'X', null, null, 3),
      edge('C', 'X', null, null, 3), // duplicate
    ];

    const withDup = computeGapsFromInputs(dupEdges, del);
    const without = computeGapsFromInputs(edges, del);

    const gDup = gapFor(withDup, 'X');
    const gBase = gapFor(without, 'X');

    expect(gDup.delivered).toEqual(gBase.delivered);
    expect(gDup.gap).toEqual(gBase.gap);
    expect(gDup.status).toEqual(gBase.status);
    expect(gDup.basis).toEqual(gBase.basis);
  });
});

// ---------------------------------------------------------------------------
// Invariant 3: REDUNDANT DIRECT+TRANSITIVE — LOWER-depth redundant prereq
//
// F→B (B delivers X@d3), needed d3. Adding a redundant F→A edge where A
// delivers X@d1 must NOT drag delivered below 3 (MAX, not average/min).
// Gap result on the key dimensions must be identical with/without A.
// ---------------------------------------------------------------------------
describe('Invariant 3 — redundant direct: MAX stability with lower-depth redundant prereq', () => {
  const edgesBase: RelyEdge[] = [edge('B', 'X', null, null, 3)];
  const delBase: DeliveredAttainment[] = [delivered('B', 'X', null, null, 3)];

  const edgesWithA: RelyEdge[] = [
    edge('B', 'X', null, null, 3),
    edge('A', 'X', null, null, 3), // redundant direct edge; A delivers only d1
  ];
  const delWithA: DeliveredAttainment[] = [
    delivered('B', 'X', null, null, 3),
    delivered('A', 'X', null, null, 1), // lower-depth — must NOT drag MAX down
  ];

  it('base (B only): delivered=3, gap=0, met', () => {
    const gaps = computeGapsFromInputs(edgesBase, delBase);
    const g = gapFor(gaps, 'X');
    expect(g.delivered.d).toBe(3);
    expect(g.gap.d).toBe(0);
    expect(g.status).toBe('met');
  });

  it('with lower-depth redundant A: delivered.d stays 3 (MAX, not dragged down)', () => {
    const withA = computeGapsFromInputs(edgesWithA, delWithA);
    const gA = gapFor(withA, 'X');

    // MAX stability: A@d1 cannot drag the result below B@d3
    expect(gA.delivered.d).toBe(3);
    expect(gA.gap.d).toBe(0);
    expect(gA.status).toBe('met');
  });

  it('with lower-depth redundant A: delivered/gap/status identical to B-only', () => {
    const withA = computeGapsFromInputs(edgesWithA, delWithA);
    const without = computeGapsFromInputs(edgesBase, delBase);

    const gA = gapFor(withA, 'X');
    const gBase = gapFor(without, 'X');

    expect(gA.delivered).toEqual(gBase.delivered);
    expect(gA.gap).toEqual(gBase.gap);
    expect(gA.status).toEqual(gBase.status);
    expect(gA.basis).toEqual(gBase.basis);
  });
});

// ---------------------------------------------------------------------------
// Basis + no_data cases
// ---------------------------------------------------------------------------
describe('basis and no_data', () => {
  it('no_data: relied prereq has no delivered row → status no_data, basis none', () => {
    const edges: RelyEdge[] = [edge('B', 'X', null, null, 3)];
    const del: DeliveredAttainment[] = []; // nothing delivered
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    expect(g.status).toBe('no_data');
    expect(g.basis).toBe('none');
  });

  it('basis measured: when measured row present for prereq', () => {
    const edges: RelyEdge[] = [edge('B', 'X', null, null, 2)];
    const del: DeliveredAttainment[] = [delivered('B', 'X', null, null, 2, 'measured')];
    const gaps = computeGapsFromInputs(edges, del);
    expect(gapFor(gaps, 'X').basis).toBe('measured');
  });

  it('gap: needed > delivered on d dim', () => {
    const edges: RelyEdge[] = [edge('B', 'X', null, null, 4)];
    const del: DeliveredAttainment[] = [delivered('B', 'X', null, null, 2)];
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    expect(g.gap.d).toBe(2);
    expect(g.status).toBe('gap');
  });

  it('measured beats intended: measured row supersedes intended for same prereq×subComp', () => {
    const edges: RelyEdge[] = [edge('B', 'X', null, null, 3)];
    const del: DeliveredAttainment[] = [
      delivered('B', 'X', null, null, 5, 'intended'), // intended claims D5
      delivered('B', 'X', null, null, 2, 'measured'),  // measured only D2
    ];
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    // measured pool wins → delivered.d = 2, not 5
    expect(g.delivered.d).toBe(2);
    expect(g.basis).toBe('measured');
    expect(g.gap.d).toBe(1); // needed 3, got 2
    expect(g.status).toBe('gap');
  });

  it('all three dims: k/u/d gaps computed independently', () => {
    const edges: RelyEdge[] = [edge('B', 'X', 4, 3, 2)];
    const del: DeliveredAttainment[] = [delivered('B', 'X', 2, 4, 2)];
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    expect(g.gap.k).toBe(2); // 4-2
    expect(g.gap.u).toBe(0); // 3-4 → clamped to 0
    expect(g.gap.d).toBe(0); // 2-2
    expect(g.status).toBe('gap'); // k gap > 0
  });

  it('null needed dim → gap 0 regardless of delivered', () => {
    const edges: RelyEdge[] = [edge('B', 'X', null, null, 2)];
    const del: DeliveredAttainment[] = [delivered('B', 'X', null, null, 0)];
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    expect(g.gap.k).toBe(0);
    expect(g.gap.u).toBe(0);
    expect(g.gap.d).toBe(2); // 2-0
  });

  it('multiple sub-comps: each resolved independently', () => {
    const edges: RelyEdge[] = [
      edge('B', 'X', null, null, 3),
      edge('B', 'Y', null, null, 2),
    ];
    const del: DeliveredAttainment[] = [
      delivered('B', 'X', null, null, 3),
      delivered('B', 'Y', null, null, 1),
    ];
    const gaps = computeGapsFromInputs(edges, del);
    expect(gaps).toHaveLength(2);
    expect(gapFor(gaps, 'X').status).toBe('met');
    expect(gapFor(gaps, 'Y').status).toBe('gap');
    expect(gapFor(gaps, 'Y').gap.d).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Per-prereq measured-vs-intended pool (Fix 2)
//
// A measured row for prereq B must NOT suppress an intended row for prereq C.
// Each prereq contributes its own measured attainment if present, else its
// intended attainment.
// ---------------------------------------------------------------------------
describe('per-prereq measured-vs-intended pool', () => {
  // Case 1: B has measured d2; C has intended d5.
  // C's intended must NOT be dropped just because B has measured data.
  // Pool = [B measured d2, C intended d5] → MAX = 5.
  // basis = 'measured' (pool contains at least one measured row).
  it('B measured d2 + C intended d5 → delivered.d=5, basis=measured (C not suppressed)', () => {
    const edges: RelyEdge[] = [
      edge('B', 'X', null, null, 3),
      edge('C', 'X', null, null, 3),
    ];
    const del: DeliveredAttainment[] = [
      delivered('B', 'X', null, null, 2, 'measured'),
      delivered('C', 'X', null, null, 5, 'intended'),
    ];
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    expect(g.delivered.d).toBe(5); // C's intended d5 is NOT suppressed by B's measured
    expect(g.basis).toBe('measured'); // pool has B's measured row
    expect(g.gap.d).toBe(0); // needed 3, delivered 5 → met
    expect(g.status).toBe('met');
  });

  // Case 2: B measured d2; C intended d1 → MAX = 2, basis = measured.
  it('B measured d2 + C intended d1 → delivered.d=2, basis=measured', () => {
    const edges: RelyEdge[] = [
      edge('B', 'X', null, null, 3),
      edge('C', 'X', null, null, 3),
    ];
    const del: DeliveredAttainment[] = [
      delivered('B', 'X', null, null, 2, 'measured'),
      delivered('C', 'X', null, null, 1, 'intended'),
    ];
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    expect(g.delivered.d).toBe(2);
    expect(g.basis).toBe('measured');
    expect(g.gap.d).toBe(1); // needed 3, delivered 2
    expect(g.status).toBe('gap');
  });

  // Case 3: single prereq, all-intended → basis = 'intended'.
  it('single prereq with only intended rows → basis=intended', () => {
    const edges: RelyEdge[] = [edge('B', 'X', null, null, 3)];
    const del: DeliveredAttainment[] = [
      delivered('B', 'X', null, null, 4, 'intended'),
    ];
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    expect(g.delivered.d).toBe(4);
    expect(g.basis).toBe('intended');
    expect(g.gap.d).toBe(0);
    expect(g.status).toBe('met');
  });
});

// ---------------------------------------------------------------------------
// Edge case: empty input
// ---------------------------------------------------------------------------
describe('edge cases', () => {
  it('empty edges → empty result', () => {
    expect(computeGapsFromInputs([], [])).toEqual([]);
  });

  it('contributingPrereqs lists the deduped prereq course codes', () => {
    const edges: RelyEdge[] = [
      edge('B', 'X', null, null, 3),
      edge('C', 'X', null, null, 3),
    ];
    const del: DeliveredAttainment[] = [
      delivered('B', 'X', null, null, 2),
      delivered('C', 'X', null, null, 3),
    ];
    const gaps = computeGapsFromInputs(edges, del);
    const g = gapFor(gaps, 'X');
    expect(g.contributingPrereqs.sort()).toEqual(['B', 'C']);
  });
});
