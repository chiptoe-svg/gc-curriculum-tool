import { describe, it, expect } from 'vitest';
import { toAuditResponse } from '../adapter';
import { buildLedger, type LedgerEvent, type SlotRecord } from '../ledger';
import { engineState } from '../engine';
import type { StagedSubmit } from '../staged-tools';

const rec = (slot: string, summary = 's'): LedgerEvent => ({
  type: 'record', record: { slot, status: 'filled_by_instructor', summary, citations: [] } as SlotRecord,
});
const submit: StagedSubmit = {
  say: 'The files show a poster project.', question: 'Which two pieces of graded work carry the course?',
  citations: [{ type: 'chunk', chunkId: 'c1', messageId: null, excerpt: 'poster' }], slot_asked: 'anchors', kind: 'question',
};
const adapt = (events: LedgerEvent[]) => {
  const ledger = buildLedger(null, events);
  return toAuditResponse(submit, engineState(null, ledger), ledger);
};

describe('toAuditResponse', () => {
  it('maps say/question/citations to finding/question/citations', () => {
    const r = adapt([]);
    expect(r.finding).toBe(submit.say);
    expect(r.question).toBe(submit.question);
    expect(r.citations).toEqual(submit.citations);
  });

  it('score is the settled share of all slots (phantom graded_on slots counted before anchors)', () => {
    // 14 slots with no map: outcomes, anchors, 2 graded_on placeholders, conditions, reasoning_evidence, tests,
    // revision, transfer, threshold, incoming, reteach, habits, recap.
    expect(adapt([]).readiness.score).toBe(0);
    const r = adapt([rec('outcomes')]);
    expect(r.readiness.score).toBe(Math.round(100 / 14));
  });

  it('covered = done stage titles; remaining = active + upcoming titles', () => {
    const r = adapt([rec('outcomes'), rec('anchors', 'A\nB')]);
    expect(r.readiness.covered).toEqual(['The course in your words']);
    expect(r.readiness.remaining).toEqual([
      'Evidence walk', 'When it goes wrong, and the leap', 'What students walk in with', 'Habits and communication', 'Objectives and close',
    ]);
  });

  it('good_enough_to_generate only once the recap is due or the interview is done', () => {
    expect(adapt([rec('outcomes')]).readiness.good_enough_to_generate).toBe(false);
    expect(adapt([{ type: 'finish' }]).readiness.good_enough_to_generate).toBe(true);
    expect(adapt([{ type: 'finish' }, rec('recap')]).readiness.good_enough_to_generate).toBe(true);
  });

  it('score never drops when anchors are recorded (placeholders become real slots)', () => {
    const before = adapt([rec('outcomes')]).readiness.score;
    const after = adapt([rec('outcomes'), rec('anchors', 'A\nB')]).readiness.score;
    expect(after).toBeGreaterThan(before);
  });
});
