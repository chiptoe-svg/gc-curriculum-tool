import { describe, it, expect } from 'vitest';
import {
  conditionsScore,
  depthWeight,
  reflectionWeight,
  snapshotPfContribution,
  cumulativePfStatus,
  depthScaffoldingStatus,
  type SnapshotCellInput,
  type ProductiveFailureConditions,
} from '../scaffolding';

describe('conditionsScore', () => {
  it('returns 1.0 when all four conditions are present', () => {
    const pf: ProductiveFailureConditions = {
      generate_then_consolidate: 'present',
      open_ended_problems: 'present',
      revision_cycles: 'present',
      structured_post_mortem: 'present',
      max_supporting_depth: 3,
      notes: [],
    };
    expect(conditionsScore(pf)).toBe(1.0);
  });

  it('returns 0.25 for two partial + two absent', () => {
    const pf: ProductiveFailureConditions = {
      generate_then_consolidate: 'partial',
      open_ended_problems: 'partial',
      revision_cycles: 'absent',
      structured_post_mortem: 'absent',
      max_supporting_depth: 1,
      notes: [],
    };
    expect(conditionsScore(pf)).toBeCloseTo(0.25, 5);
  });

  it('returns 0 when null', () => {
    expect(conditionsScore(null)).toBe(0);
  });
});

describe('depthWeight', () => {
  it('matches the spec ramp', () => {
    expect(depthWeight(0)).toBe(0.0);
    expect(depthWeight(1)).toBe(0.15);
    expect(depthWeight(2)).toBe(0.35);
    expect(depthWeight(3)).toBe(0.60);
    expect(depthWeight(4)).toBe(0.85);
    expect(depthWeight(5)).toBe(1.0);
  });
});

describe('reflectionWeight', () => {
  it('1.0 / 0.75 / 0.5 for present / partial / absent', () => {
    expect(reflectionWeight('present')).toBe(1.0);
    expect(reflectionWeight('partial')).toBe(0.75);
    expect(reflectionWeight('absent')).toBe(0.5);
  });
});

describe('cumulativePfStatus', () => {
  it('returns absent below 0.1', () => {
    expect(cumulativePfStatus(0.05, false)).toBe('absent');
  });
  it('returns thin in 0.1-0.5', () => {
    expect(cumulativePfStatus(0.3, false)).toBe('thin');
  });
  it('returns developing in 0.5-1.5', () => {
    expect(cumulativePfStatus(1.0, false)).toBe('developing');
  });
  it('returns well_developed when >= 1.5 AND has upper-depth contributor', () => {
    expect(cumulativePfStatus(1.6, true)).toBe('well_developed');
  });
  it('caps at developing when >= 1.5 but no upper-depth contributor', () => {
    expect(cumulativePfStatus(1.6, false)).toBe('developing');
  });
});

describe('depthScaffoldingStatus', () => {
  const cell = (d: number, k: number | null = 1, u: number | null = 1, sequenceIndex: number = 0): SnapshotCellInput => ({
    snapshotId: `s${sequenceIndex}`,
    courseCode: `GC ${1000 + sequenceIndex}`,
    sequenceIndex,
    kDepth: k,
    uDepth: u,
    dDepth: d,
    productiveFailureConditions: null,
  });

  it('returns not_addressed when no contributing snapshot reaches K=1', () => {
    expect(depthScaffoldingStatus([cell(0, 0, 0)]).status).toBe('not_addressed');
  });

  it('returns coverage_only when shallow across many courses, never integration', () => {
    expect(depthScaffoldingStatus([
      cell(1, 1, 1, 0),
      cell(2, 2, 1, 1),
      cell(1, 2, 1, 2),
    ]).status).toBe('coverage_only');
  });

  it('returns well_scaffolded when all three phases present in sequence', () => {
    expect(depthScaffoldingStatus([
      cell(1, 1, 0, 0),  // introduction
      cell(3, 3, 2, 1),  // practice
      cell(4, 4, 4, 2),  // integration
    ]).status).toBe('well_scaffolded');
  });

  it('returns top_heavy when introduction + integration present but practice missing', () => {
    expect(depthScaffoldingStatus([
      cell(1, 1, 0, 0),
      cell(4, 4, 4, 1),
    ]).status).toBe('top_heavy');
  });

  it('returns brittle_scaffold when integration appears before introduction in sequence', () => {
    expect(depthScaffoldingStatus([
      cell(4, 4, 4, 0),  // integration FIRST in sequence
      cell(1, 1, 0, 1),  // introduction AFTER
    ]).status).toBe('brittle_scaffold');
  });

  it('does NOT flag a single course that both introduces and integrates as brittle', () => {
    // K=2 (introduction) + D=4 (integration) in ONE cell, same sequenceIndex —
    // "introduce + do at depth" is legitimate, not a missing-setup defect.
    const result = depthScaffoldingStatus([cell(4, 2, 1, 0)]);
    expect(result.phases).toEqual({ introduction: true, practice: false, integration: true });
    expect(result.status).not.toBe('brittle_scaffold');
    expect(result.status).toBe('top_heavy'); // intro + integration, no practice
  });

  it('flags integration with setup only at a LATER sequence position as brittle', () => {
    // intro at seq 2, integration at seq 1 → no setup at-or-before integration.
    expect(depthScaffoldingStatus([
      cell(4, 4, 4, 1),  // integration
      cell(1, 1, 0, 2),  // introduction comes later in sequence
    ]).status).toBe('brittle_scaffold');
  });
});
