import { describe, it, expect } from 'vitest';
import { buildWhatIfProfile } from '@/lib/what-if/profile';
import type { WhatIfEstimate } from '@/lib/what-if/types';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { baseProfile, foundationalRow } from '../../helpers/capture-profile-fixture';

const technical = {
  statement: 'Prepare print-ready files.',
  type: 'technical' as const,
  k_depth: 3, u_depth: 2, d_depth: 3,
  evidence_k: 'quiz', evidence_u: 'reflection', evidence_d: 'graded file',
  rationale: 'x',
};
const approved = baseProfile([technical, foundationalRow('Attention to detail')]) as unknown as CaptureProfile;

const est = (over: Partial<WhatIfEstimate> = {}): WhatIfEstimate => ({
  changeItems: [], movedRatings: [], newCompetencies: [], incomingChanges: [], ...over,
});

describe('buildWhatIfProfile', () => {
  it('copies untouched ratings exactly', () => {
    const p = buildWhatIfProfile(approved, est(), new Set());
    expect(p.ratings).toHaveLength(2);
    expect(p.ratings[0]).toMatchObject({
      statement: 'Prepare print-ready files.', type: 'technical', status: 'approved',
      kud: { k: 3, u: 2, d: 3 }, before: { k: 3, u: 2, d: 3 }, confidence: null, reason: null,
      subCompetencyId: null, linked: false,
    });
    expect(p.ratings[1]).toMatchObject({ type: 'foundational', kud: { k: null, u: null, d: 2 } });
  });

  it('applies a moved rating, taking "before" from the approved profile', () => {
    const p = buildWhatIfProfile(approved, est({ movedRatings: [
      { statement: ' prepare  PRINT-ready files.', after: { k: 3, u: 3, d: 2 }, confidence: 'medium', reason: 'r' },
    ] }), new Set());
    expect(p.ratings[0]).toMatchObject({
      status: 'moved', before: { k: 3, u: 2, d: 3 }, kud: { k: 3, u: 3, d: 2 }, confidence: 'medium', reason: 'r',
    });
  });

  it('a "moved" rating equal to the approved values stays approved', () => {
    const p = buildWhatIfProfile(approved, est({ movedRatings: [
      { statement: 'Prepare print-ready files.', after: { k: 3, u: 2, d: 3 }, confidence: 'high', reason: 'r' },
    ] }), new Set());
    expect(p.ratings[0]).toMatchObject({ status: 'approved', confidence: null, reason: null });
  });

  it('a moved statement that matches nothing becomes a new, unlinked rating', () => {
    const p = buildWhatIfProfile(approved, est({ movedRatings: [
      { statement: 'Something else', after: { k: 1, u: 1, d: 1 }, confidence: 'low', reason: 'r' },
    ] }), new Set());
    expect(p.ratings).toHaveLength(3);
    expect(p.ratings[2]).toMatchObject({
      statement: 'Something else', type: 'technical', status: 'new', before: null,
      kud: { k: 1, u: 1, d: 1 }, linked: false, subCompetencyId: null,
    });
  });

  it('forces K and U to null on a foundational competency, moved or new', () => {
    const p = buildWhatIfProfile(approved, est({
      movedRatings: [{ statement: 'Attention to detail', after: { k: 3, u: 3, d: 4 }, confidence: 'low', reason: 'r' }],
      newCompetencies: [{ statement: 'Resilience', type: 'foundational', predicted: { k: 2, u: 2, d: 3 },
        subCompetencyId: null, confidence: 'low', reason: 'r' }],
    }), new Set());
    expect(p.ratings[1]).toMatchObject({ status: 'moved', kud: { k: null, u: null, d: 4 }, before: { k: null, u: null, d: 2 } });
    expect(p.ratings[2]).toMatchObject({ status: 'new', type: 'foundational', kud: { k: null, u: null, d: 3 } });
  });

  const withNew = (id: string | null) => est({ newCompetencies: [
    { statement: 'Manage color', type: 'technical', predicted: { k: 2, u: 1, d: 2 }, subCompetencyId: id, confidence: 'medium', reason: 'r' },
  ] });

  it('drops an invented catalog id', () => {
    const p = buildWhatIfProfile(approved, withNew('made-up'), new Set(['color-management']));
    expect(p.ratings[2]).toMatchObject({ status: 'new', subCompetencyId: null, linked: false });
  });

  it('keeps a real catalog id', () => {
    const p = buildWhatIfProfile(approved, withNew('color-management'), new Set(['color-management']));
    expect(p.ratings[2]).toMatchObject({ status: 'new', subCompetencyId: 'color-management', linked: true });
  });

  it('first entry wins when one statement is moved twice', () => {
    const p = buildWhatIfProfile(approved, est({ movedRatings: [
      { statement: 'Prepare print-ready files.', after: { k: 4, u: 4, d: 4 }, confidence: 'high', reason: 'first' },
      { statement: 'prepare print-ready files.', after: { k: 0, u: 0, d: 0 }, confidence: 'low', reason: 'second' },
    ] }), new Set());
    expect(p.ratings).toHaveLength(2);
    expect(p.ratings[0]).toMatchObject({ kud: { k: 4, u: 4, d: 4 }, reason: 'first' });
  });

  it('marks an incoming change with an unknown catalog id as not linked', () => {
    const p = buildWhatIfProfile(approved, est({ incomingChanges: [
      { kind: 'new', statement: 'a', expected: null, subCompetencyId: 'nope' },
      { kind: 'raised', statement: 'b', expected: { k: 1, u: null, d: 2 }, subCompetencyId: 'real' },
      { kind: 'dropped', statement: 'c', expected: null, subCompetencyId: null },
    ] }), new Set(['real']));
    expect(p.incomingChanges.map(c => c.linked)).toEqual([false, true, false]);
  });
});
