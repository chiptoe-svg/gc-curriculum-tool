import { describe, it, expect } from 'vitest';
import { upwardBumps, assembleOverrides } from '@/lib/ai/capture/score-overrides';
import type { CaptureCompetency } from '@/lib/ai/capture/schema';

function comp(o: Partial<CaptureCompetency>): CaptureCompetency {
  return {
    statement: 'Mixes spot-color inks', type: 'technical',
    k_depth: 2, u_depth: 2, d_depth: 2,
    evidence_k: 'k', evidence_u: 'u', evidence_d: 'd', rationale: 'r',
    ...o,
  } as CaptureCompetency;
}

describe('upwardBumps', () => {
  it('flags a single upward dimension with from/to', () => {
    const bumps = upwardBumps([comp({ d_depth: 2 })], [comp({ d_depth: 4 })]);
    expect(bumps).toHaveLength(1);
    expect(bumps[0]!.changes).toEqual([{ dim: 'd', from: 2, to: 4 }]);
    expect(bumps[0]!.index).toBe(0);
  });

  it('ignores downward and unchanged edits', () => {
    const base = [comp({ k_depth: 3, u_depth: 2, d_depth: 2 })];
    const work = [comp({ k_depth: 1, u_depth: 2, d_depth: 2 })];
    expect(upwardBumps(base, work)).toEqual([]);
  });

  it('captures multiple bumped dimensions in one entry', () => {
    const base = [comp({ k_depth: 1, u_depth: 1, d_depth: 1 })];
    const work = [comp({ k_depth: 3, u_depth: 1, d_depth: 4 })];
    expect(upwardBumps(base, work)[0]!.changes).toEqual([{ dim: 'k', from: 1, to: 3 }, { dim: 'd', from: 1, to: 4 }]);
  });

  it('handles foundationals (null K/U) — only D can bump', () => {
    const base = [comp({ type: 'foundational', k_depth: null, u_depth: null, d_depth: 1, evidence_k: null, evidence_u: null })];
    const work = [comp({ type: 'foundational', k_depth: null, u_depth: null, d_depth: 3, evidence_k: null, evidence_u: null })];
    expect(upwardBumps(base, work)[0]!.changes).toEqual([{ dim: 'd', from: 1, to: 3 }]);
  });
});

describe('assembleOverrides', () => {
  it('records only bumped rows that have a non-empty reason', () => {
    const base = [comp({ statement: 'A', d_depth: 2 }), comp({ statement: 'B', d_depth: 2 })];
    const work = [comp({ statement: 'A', d_depth: 4 }), comp({ statement: 'B', d_depth: 4 })];
    const reasons = new Map<number, string>([[0, 'capstone press checks'], [1, '   ']]);
    expect(assembleOverrides(base, work, reasons)).toEqual([
      { statement: 'A', changes: [{ dim: 'd', from: 2, to: 4 }], reason: 'capstone press checks' },
    ]);
  });

  it('returns [] when nothing was bumped', () => {
    const base = [comp({ d_depth: 2 })];
    expect(assembleOverrides(base, base, new Map())).toEqual([]);
  });
});
