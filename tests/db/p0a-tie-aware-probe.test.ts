// @vitest-environment node
// Pure-function tests for probes.ts's tieAwareTargetSubstrate — no DB. Red-proofs
// the controller-ruled narrowing added 2026-10-11 to the loadTargetSubstrate
// characterization comparison: a tied sub-competency's arbitrary winner must be
// ignored, but a NON-tied winner change, or any change to the max dDepth itself
// (tied or not), must still fail the comparison — AND (fix round 1, same-day
// review) each side's own recorded winner must still be a genuine member of
// the live tie set, or that side stays raw and the comparison fails. See
// probes.ts's tieAwareTargetSubstrate doc comment for the full rationale.
import { describe, it, expect } from 'vitest';
import { tieAwareTargetSubstrate, type TieSetEntry } from './p0a/probes';

const entry = (subCompetencyId: string, overrides: Partial<Record<string, unknown>> = {}) => ({
  subCompetencyId,
  subCompetencyName: subCompetencyId,
  bestCourseCode: 'GC 1010',
  kDepth: 1,
  uDepth: 1,
  dDepth: 2,
  evidenceExcerpt: 'e',
  ...overrides,
});

const TARGET = 't1';

describe('tieAwareTargetSubstrate', () => {
  it('reduces a genuinely tied sub-competency to {dDepth, tied}, regardless of which cell each side recorded as the winner', () => {
    const tieSets = new Map<string, TieSetEntry>([
      [`${TARGET}|tied-sub`, {
        dDepth: 2,
        tied: [
          { courseCode: 'GC 1010', snapshotId: 's1' },
          { courseCode: 'GC 2020', snapshotId: 's2' },
        ],
      }],
    ]);
    const now = { [TARGET]: { coverageRollup: [entry('tied-sub', { bestCourseCode: 'GC 1010' })] } };
    const golden = { [TARGET]: { coverageRollup: [entry('tied-sub', { bestCourseCode: 'GC 2020', kDepth: 3 })] } };

    // Different arbitrary winners (and even a different kDepth, which legitimately
    // varies by which tied cell won) — must compare EQUAL once narrowed.
    expect(tieAwareTargetSubstrate(now, tieSets)).toEqual(tieAwareTargetSubstrate(golden, tieSets));
  });

  it('RED-PROOF: a non-tied sub-competency with a DIFFERENT winner still fails the comparison', () => {
    // No tie set entry for this sub-competency at all → tieAwareTargetSubstrate
    // must pass every field through unchanged.
    const tieSets = new Map<string, TieSetEntry>();
    const now = { [TARGET]: { coverageRollup: [entry('solo-sub', { bestCourseCode: 'GC 1010' })] } };
    const golden = { [TARGET]: { coverageRollup: [entry('solo-sub', { bestCourseCode: 'GC 9999' })] } };

    expect(tieAwareTargetSubstrate(now, tieSets))
      .not.toEqual(tieAwareTargetSubstrate(golden, tieSets));
  });

  it('RED-PROOF: a sub-competency with only ONE tied candidate (not a real tie) still fails on a winner change', () => {
    const tieSets = new Map<string, TieSetEntry>([
      [`${TARGET}|solo-sub`, { dDepth: 2, tied: [{ courseCode: 'GC 1010', snapshotId: 's1' }] }],
    ]);
    const now = { [TARGET]: { coverageRollup: [entry('solo-sub', { bestCourseCode: 'GC 1010' })] } };
    const golden = { [TARGET]: { coverageRollup: [entry('solo-sub', { bestCourseCode: 'GC 9999' })] } };

    expect(tieAwareTargetSubstrate(now, tieSets))
      .not.toEqual(tieAwareTargetSubstrate(golden, tieSets));
  });

  it('RED-PROOF: a tied sub-competency whose max dDepth itself changed still fails the comparison', () => {
    const tieSets = new Map<string, TieSetEntry>([
      [`${TARGET}|tied-sub`, {
        dDepth: 2,
        tied: [
          { courseCode: 'GC 1010', snapshotId: 's1' },
          { courseCode: 'GC 2020', snapshotId: 's2' },
        ],
      }],
    ]);
    const now = { [TARGET]: { coverageRollup: [entry('tied-sub', { dDepth: 2 })] } };
    const golden = { [TARGET]: { coverageRollup: [entry('tied-sub', { dDepth: 3 })] } };

    expect(tieAwareTargetSubstrate(now, tieSets))
      .not.toEqual(tieAwareTargetSubstrate(golden, tieSets));
  });

  it('RED-PROOF (fix round 1, membership guard): a golden winner that is NOT a member of the live tie set still fails the comparison', () => {
    // Without the membership guard, tie.tied.length > 1 alone was enough to
    // reduce BOTH sides to the same {dDepth, tied} shape — so a golden winner
    // that no longer exists among the live tied candidates at all (a real
    // regression: the underlying data moved, not just "which tied cell won")
    // would still compare equal. The guard requires each side's OWN
    // bestCourseCode to actually be a member of tie.tied before reducing.
    const tieSets = new Map<string, TieSetEntry>([
      [`${TARGET}|tied-sub`, {
        dDepth: 2,
        tied: [
          { courseCode: 'GC 1010', snapshotId: 's1' },
          { courseCode: 'GC 2020', snapshotId: 's2' },
        ],
      }],
    ]);
    // now's winner IS a genuine tied member → eligible to reduce.
    const now = { [TARGET]: { coverageRollup: [entry('tied-sub', { bestCourseCode: 'GC 1010' })] } };
    // golden's recorded winner is NOT among the live tied candidates at all.
    const golden = { [TARGET]: { coverageRollup: [entry('tied-sub', { bestCourseCode: 'GC 9999' })] } };

    expect(tieAwareTargetSubstrate(now, tieSets))
      .not.toEqual(tieAwareTargetSubstrate(golden, tieSets));
  });

  it('a legitimate tie with different winners (and a different dDepth-irrelevant field) on BOTH sides still passes', () => {
    // Companion to the membership-guard red-proof above: when each side's own
    // winner IS a genuine member of the (shared) live tie set, the comparison
    // must still pass — the guard narrows false positives, not the original
    // widening this whole mechanism exists for.
    const tieSets = new Map<string, TieSetEntry>([
      [`${TARGET}|tied-sub`, {
        dDepth: 2,
        tied: [
          { courseCode: 'GC 1010', snapshotId: 's1' },
          { courseCode: 'GC 2020', snapshotId: 's2' },
        ],
      }],
    ]);
    const now = { [TARGET]: { coverageRollup: [entry('tied-sub', { bestCourseCode: 'GC 1010', kDepth: 1 })] } };
    const golden = { [TARGET]: { coverageRollup: [entry('tied-sub', { bestCourseCode: 'GC 2020', kDepth: 4 })] } };

    expect(tieAwareTargetSubstrate(now, tieSets)).toEqual(tieAwareTargetSubstrate(golden, tieSets));
  });

  it('re-sorts by subCompetencyId so entries are compared against the same sub-competency even when a changed winner would otherwise shift array position', () => {
    const tieSets = new Map<string, TieSetEntry>();
    // "now" and "golden" differ only in each entry's bestCourseCode, which is
    // exactly what the pre-fix sortJson(...) keyed its ordering on — so a naive
    // positional (index-based) comparison after a winner change would compare
    // the WRONG sub-competencies against each other. Deliberately pass the two
    // entries in already-divergent orders to prove the function's own re-sort
    // (not sortJson, which already ran upstream) is what fixes alignment.
    const now = { [TARGET]: { coverageRollup: [entry('a-sub', { bestCourseCode: 'ZZ 0001' }), entry('b-sub', { bestCourseCode: 'AA 0001' })] } };
    const golden = { [TARGET]: { coverageRollup: [entry('b-sub', { bestCourseCode: 'ZZ 0002' }), entry('a-sub', { bestCourseCode: 'AA 0002' })] } };

    // Neither sub-competency is tied, so winners still must differ — this proves
    // re-sorting alone doesn't erase real differences, only realigns identity.
    const nowOut = tieAwareTargetSubstrate(now, tieSets)[TARGET] as { coverageRollup: Array<{ subCompetencyId: string }> };
    const goldOut = tieAwareTargetSubstrate(golden, tieSets)[TARGET] as { coverageRollup: Array<{ subCompetencyId: string }> };
    expect(nowOut.coverageRollup.map(e => e.subCompetencyId)).toEqual(['a-sub', 'b-sub']);
    expect(goldOut.coverageRollup.map(e => e.subCompetencyId)).toEqual(['a-sub', 'b-sub']);
    expect(nowOut).not.toEqual(goldOut);
  });
});
