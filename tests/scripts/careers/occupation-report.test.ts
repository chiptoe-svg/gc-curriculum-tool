// @vitest-environment node
// P1 Task 4 — unit tests for the pure scoring helper in
// scripts/careers/occupation-report.ts. No DB.
import { describe, it, expect } from 'vitest';
import {
  rescaleImportance,
  topElementsByShareWeightedImportance,
  type MixShareRow,
  type ElementImportanceRow,
} from '@/scripts/careers/occupation-report';

function mix(overrides: Partial<MixShareRow> = {}): MixShareRow {
  return { onetSocCode: '11-1011.00', onetStatus: 'rated', share: 1, ...overrides };
}

function rating(overrides: Partial<ElementImportanceRow> = {}): ElementImportanceRow {
  return {
    onetSocCode: '11-1011.00', domain: 'knowledge', elementId: 'E1', elementName: 'Elem1',
    scaleId: 'IM', dataValue: 5, recommendSuppress: false, ...overrides,
  };
}

describe('rescaleImportance — spec §5.4: (IM - 1) / 4', () => {
  it('maps the 1-5 Importance scale onto 0-1', () => {
    expect(rescaleImportance(1)).toBe(0);
    expect(rescaleImportance(5)).toBe(1);
    expect(rescaleImportance(3)).toBeCloseTo(0.5);
  });
});

describe('topElementsByShareWeightedImportance', () => {
  it('weights each element by share × rescaled IM and sums across occupations in the mix', () => {
    const mixRows = [
      mix({ onetSocCode: 'A', share: 0.6 }),
      mix({ onetSocCode: 'B', share: 0.4 }),
    ];
    const ratings = [
      rating({ onetSocCode: 'A', dataValue: 5 }), // rescaled 1.0
      rating({ onetSocCode: 'B', dataValue: 1 }), // rescaled 0.0
    ];
    const { top, suppressedCount } = topElementsByShareWeightedImportance(mixRows, ratings);
    expect(suppressedCount).toBe(0);
    expect(top).toEqual([{ domain: 'knowledge', elementId: 'E1', elementName: 'Elem1', score: 0.6 * 1 + 0.4 * 0 }]);
  });

  it('sums contributions for the same element across multiple occupations', () => {
    const mixRows = [mix({ onetSocCode: 'A', share: 0.5 }), mix({ onetSocCode: 'B', share: 0.5 })];
    const ratings = [
      rating({ onetSocCode: 'A', dataValue: 5 }), // 0.5 * 1.0 = 0.5
      rating({ onetSocCode: 'B', dataValue: 5 }), // 0.5 * 1.0 = 0.5
    ];
    const { top } = topElementsByShareWeightedImportance(mixRows, ratings);
    expect(top).toEqual([{ domain: 'knowledge', elementId: 'E1', elementName: 'Elem1', score: 1 }]);
  });

  it('ignores unrated and no_fit mix rows (no share contributed, even if they somehow had an onetSocCode)', () => {
    const mixRows = [
      mix({ onetSocCode: 'A', onetStatus: 'rated', share: 0.5 }),
      mix({ onetSocCode: 'B', onetStatus: 'unrated', share: 0.3 }),
      mix({ onetSocCode: null, onetStatus: 'no_fit', share: 0.2 }),
    ];
    const ratings = [
      rating({ onetSocCode: 'A', dataValue: 5 }),
      rating({ onetSocCode: 'B', dataValue: 5 }), // must NOT contribute: B is unrated in the mix
    ];
    const { top } = topElementsByShareWeightedImportance(mixRows, ratings);
    expect(top).toEqual([{ domain: 'knowledge', elementId: 'E1', elementName: 'Elem1', score: 0.5 }]);
  });

  it('skips recommend_suppress ratings and counts them, never scoring them', () => {
    const mixRows = [mix({ onetSocCode: 'A', share: 1 })];
    const ratings = [
      rating({ onetSocCode: 'A', elementId: 'E1', dataValue: 5, recommendSuppress: true }),
      rating({ onetSocCode: 'A', elementId: 'E2', elementName: 'Elem2', dataValue: 3, recommendSuppress: false }),
    ];
    const { top, suppressedCount } = topElementsByShareWeightedImportance(mixRows, ratings);
    expect(suppressedCount).toBe(1);
    expect(top).toEqual([{ domain: 'knowledge', elementId: 'E2', elementName: 'Elem2', score: rescaleImportance(3) }]);
  });

  it('ignores non-IM scale rows defensively (e.g. LV passed in by mistake)', () => {
    const mixRows = [mix({ onetSocCode: 'A', share: 1 })];
    const ratings = [rating({ onetSocCode: 'A', scaleId: 'LV', dataValue: 7 })];
    const { top } = topElementsByShareWeightedImportance(mixRows, ratings);
    expect(top).toEqual([]);
  });

  it('ignores an element rating whose occupation never appears as rated in the mix', () => {
    const mixRows = [mix({ onetSocCode: 'A', share: 1 })];
    const ratings = [rating({ onetSocCode: 'Z', dataValue: 5 })];
    const { top } = topElementsByShareWeightedImportance(mixRows, ratings);
    expect(top).toEqual([]);
  });

  it('returns the top N sorted descending by score, default limit 15', () => {
    const mixRows = [mix({ onetSocCode: 'A', share: 1 })];
    const ratings = Array.from({ length: 20 }, (_, i) =>
      rating({ onetSocCode: 'A', elementId: `E${i}`, elementName: `Elem${i}`, dataValue: 1 + (i % 5) }));
    const { top } = topElementsByShareWeightedImportance(mixRows, ratings);
    expect(top).toHaveLength(15);
    for (let i = 1; i < top.length; i++) {
      expect(top[i - 1]!.score).toBeGreaterThanOrEqual(top[i]!.score);
    }
  });

  it('respects an explicit smaller limit', () => {
    const mixRows = [mix({ onetSocCode: 'A', share: 1 })];
    const ratings = [
      rating({ onetSocCode: 'A', elementId: 'E1', elementName: 'Elem1', dataValue: 5 }),
      rating({ onetSocCode: 'A', elementId: 'E2', elementName: 'Elem2', dataValue: 3 }),
    ];
    const { top } = topElementsByShareWeightedImportance(mixRows, ratings, 1);
    expect(top).toHaveLength(1);
    expect(top[0]!.elementId).toBe('E1');
  });
});
