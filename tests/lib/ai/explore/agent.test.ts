import { describe, it, expect } from 'vitest';
import { emittedToEvents } from '@/lib/ai/explore/agent';
import type { Scenario } from '@/lib/ai/explore/scenario';

const s = { id: 'x', courseCode: 'GC 3460', baselineSnapshotId: 'b', change: { prose:'p',activity:'a',artifact:'graded',competencies:[],rubricCriteria:[],assumesIncoming:[] }, predictedDeltas: [], computedRipple: [], createdAt: '2026-07-08T00:00:00.000Z' } as unknown as Scenario;

describe('emittedToEvents', () => {
  it('maps a scenario emit to a scenario stream event', () => {
    expect(emittedToEvents([{ kind: 'scenario', scenario: s }])).toEqual([{ kind: 'scenario', scenario: s }]);
  });
  it('maps a comparison emit to a comparison stream event', () => {
    const diff = { deltaChanges: [], rippleOnlyInA: [], rippleOnlyInB: [] };
    const evs = emittedToEvents([{ kind: 'comparison', a: s, b: s, diff } as any]);
    expect(evs).toEqual([{ kind: 'comparison', a: s, b: s, diff }]);
  });
  it('preserves order and passes multiple through', () => {
    expect(emittedToEvents([{ kind: 'scenario', scenario: s }, { kind: 'scenario', scenario: s }])).toHaveLength(2);
  });
});
