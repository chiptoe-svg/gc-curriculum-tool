import { describe, it, expect } from 'vitest';
import { buildLedger, type AskedTurn, type SlotRecord } from '../ledger';
import { engineState, checkTurn, settledCount, isFilled } from '../engine';
import type { EvidenceMap } from '../evidence-map';
import { STAGES } from '../stages';

type Ev = Parameters<typeof buildLedger>[1][number];
const rec = (slot: string, summary = 'sum'): Ev => ({
  type: 'record',
  record: { slot, status: 'filled_by_instructor', summary, citations: [] } as SlotRecord,
});
const ask = (stage: AskedTurn['stage'], slot: string, kind: AskedTurn['kind'] = 'question'): Ev => ({
  type: 'asked', turn: { stage, slot, kind },
});
const map = (notFound = false): EvidenceMap => ({
  summary: '', graded_work: [], tests: [], competencies: [], assumed_skills: [],
  objectives: notFound ? [{ text: 'o', status: 'not_found', graded_work: [] }] : [{ text: 'o', status: 'graded_work_found', graded_work: ['x'] }],
  conflicts: [], unreadable: [],
});
const st = (events: Ev[], m: EvidenceMap | null = null) => {
  const ledger = buildLedger(m, events);
  return { ledger, state: engineState(m, ledger) };
};
/** n counted questions spread so no stage cap closes early: fillers on stage 5/6 style. */
const counted = (n: number): Ev[] => Array.from({ length: n }, (_, i) => ask(((i % 2) + 1) as 1 | 2, `x${i}`, 'follow_up'));

describe('stage table', () => {
  it('has the exact titles, skills and plan/cap', () => {
    expect(STAGES.map((s) => [s.id, s.title, s.skill, s.planned, s.cap])).toEqual([
      [1, 'The course in your words', 'stage-1-course', 2, 3],
      [2, 'Evidence walk', 'stage-2-evidence', 5, 7],
      [3, 'When it goes wrong, and the leap', 'stage-3-wrong-and-leap', 3, 4],
      [4, 'What students walk in with', 'stage-4-incoming', 2, 3],
      [5, 'Habits and communication', 'stage-5-habits', 1, 2],
      [6, 'Objectives and close', 'stage-6-objectives', 2, 3],
    ]);
  });
});

describe('engineState', () => {
  it('starts at stage 1 with outcomes and anchors open', () => {
    const { state } = st([]);
    expect(state.stage).toBe(1);
    expect(state.openSlots).toEqual(['outcomes', 'anchors']);
    expect(state.questionsAsked).toBe(0);
    expect(state.done).toBe(false);
    expect(state.stageProgress[0]).toMatchObject({ id: 1, status: 'active' });
    expect(state.stageProgress[1]).toMatchObject({ id: 2, status: 'upcoming' });
  });

  it('volunteered slot is skipped', () => {
    const { state } = st([
      rec('threshold'), rec('outcomes'), rec('anchors', 'A\nB'),
      rec('graded_on:A'), rec('graded_on:B'), rec('conditions'), rec('reasoning_evidence'), rec('tests'),
    ]);
    expect(state.stage).toBe(3);
    expect(state.openSlots).toEqual(['revision', 'transfer']);
  });

  it('stage cap closes stage', () => {
    const { state } = st([
      ask(1, 'outcomes'), rec('outcomes'),
      ask(1, 'anchors'), ask(1, 'anchors', 'follow_up'), ask(1, 'anchors', 'follow_up'),
    ]);
    expect(state.stage).toBe(2);
    expect(state.slotStatus.anchors).toBe('not_reached');
    expect(state.openSlots).toEqual(['conditions', 'reasoning_evidence', 'tests']);
  });

  it('question 19 forces recap', () => {
    const { state } = st(counted(19));
    expect(state.questionsAsked).toBe(19);
    expect(state.mustRecap).toBe(true);
    expect(state.stage).toBe(6);
    expect(state.openSlots).toEqual(['recap']);
  });

  it('18 questions do not force recap', () => {
    expect(st(counted(18)).state.mustRecap).toBe(false);
  });

  it('finish jumps to recap', () => {
    const { state } = st([{ type: 'finish' }]);
    expect(state.mustRecap).toBe(true);
    expect(state.stage).toBe(6);
    expect(state.openSlots).toEqual(['recap']);
    expect(state.stageProgress.slice(0, 5).every((p) => p.status === 'done')).toBe(true);
  });

  it('answer_only not counted', () => {
    const { state } = st([ask(1, 'outcomes', 'answer_only'), ask(1, 'outcomes')]);
    expect(state.questionsAsked).toBe(1);
  });

  it('card counts once', () => {
    const { state } = st([ask(4, 'incoming')]);
    expect(state.questionsAsked).toBe(1);
  });

  it('stage 6 without unevidenced objectives has only recap', () => {
    const { state } = st([{ type: 'finish' }], map(false));
    expect(state.openSlots).toEqual(['recap']);
    const all = STAGES[5]!.slots(map(false), []);
    expect(all).toEqual(['recap']);
    expect(STAGES[5]!.slots(map(true), [])).toEqual(['objectives', 'recap']);
  });

  it('stage 6 lists objectives then recap when some objective is not_found', () => {
    const events: Ev[] = [
      rec('outcomes'), rec('anchors', 'A'), rec('graded_on:A'), rec('conditions'), rec('reasoning_evidence'), rec('tests'),
      rec('revision'), rec('transfer'), rec('threshold'), rec('incoming'), rec('reteach'), rec('habits'),
    ];
    const { state } = st(events, map(true));
    expect(state.stage).toBe(6);
    expect(state.openSlots).toEqual(['objectives', 'recap']);
  });

  it('done after recap answered', () => {
    const { state } = st([{ type: 'finish' }, ask(6, 'recap', 'recap'), rec('recap')]);
    expect(state.done).toBe(true);
    expect(state.stageProgress.every((p) => p.status === 'done')).toBe(true);
  });

  it('finish persists: finished ledger keeps mustRecap', () => {
    const { ledger, state } = st([{ type: 'finish' }]);
    expect(ledger.finished).toBe(true);
    expect(state.mustRecap).toBe(true);
  });
});

describe('checkTurn', () => {
  it('re-ask of filled slot is sent back, quoting the earlier summary', () => {
    const { state, ledger } = st([rec('outcomes', 'Students learn color theory')]);
    const r = checkTurn(state, ledger, { stage: 1, slot: 'outcomes', kind: 'question' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sendBack).toContain('Students learn color theory');
  });

  it('a fresh question on an open slot is ok', () => {
    const { state, ledger } = st([]);
    expect(checkTurn(state, ledger, { stage: 1, slot: 'outcomes', kind: 'question' })).toEqual({ ok: true });
  });

  it('follow-up on a filled slot is ok once; second is sent back', () => {
    const { state, ledger } = st([rec('outcomes', 'x'), ask(1, 'outcomes'), ask(1, 'outcomes', 'follow_up')]);
    expect(checkTurn(state, ledger, { stage: 1, slot: 'outcomes', kind: 'follow_up' }).ok).toBe(false);
    const fresh = st([rec('outcomes', 'x'), ask(1, 'outcomes')]);
    expect(checkTurn(fresh.state, fresh.ledger, { stage: 1, slot: 'outcomes', kind: 'follow_up' }).ok).toBe(true);
  });

  it('sixth follow-up overall is sent back', () => {
    const evs: Ev[] = ['a', 'b', 'c', 'd', 'e'].map((s) => ask(3, s, 'follow_up'));
    const { state, ledger } = st(evs);
    expect(state.followUpsUsed).toBe(5);
    expect(checkTurn(state, ledger, { stage: 3, slot: 'f', kind: 'follow_up' }).ok).toBe(false);
  });

  it('answer_only is always ok', () => {
    const { state, ledger } = st([rec('outcomes')]);
    expect(checkTurn(state, ledger, { stage: 1, slot: 'outcomes', kind: 'answer_only' })).toEqual({ ok: true });
  });

  it('when a recap is due, a non-recap question is sent back', () => {
    const { state, ledger } = st([{ type: 'finish' }]);
    expect(checkTurn(state, ledger, { stage: 3, slot: 'revision', kind: 'question' }).ok).toBe(false);
    expect(checkTurn(state, ledger, { stage: 6, slot: 'recap', kind: 'recap' }).ok).toBe(true);
  });
});

describe('settledCount', () => {
  it('never decreases across asked turns and records', () => {
    const m = map(true);
    const steps: Ev[] = [
      ask(1, 'outcomes'), rec('outcomes'),
      ask(1, 'anchors'), rec('anchors', 'A\nB'),
      ask(2, 'graded_on:A'), rec('graded_on:A'),
      ask(2, 'graded_on:B'), ask(2, 'graded_on:B', 'follow_up'), ask(2, 'conditions'), ask(2, 'conditions', 'follow_up'),
      ask(2, 'reasoning_evidence'), ask(2, 'tests'), ask(2, 'tests', 'follow_up'),
      rec('threshold'), ask(3, 'revision'), rec('revision'),
    ];
    let prev = -1;
    const events: Ev[] = [];
    for (const s of steps) {
      events.push(s);
      const { state, ledger } = st(events, m);
      const { settled, total } = settledCount(state, ledger);
      const pct = settled / total;
      expect(pct).toBeGreaterThanOrEqual(prev);
      prev = pct;
    }
    expect(prev).toBeGreaterThan(0);
  });
});

describe('isFilled', () => {
  it('true for any status, false for undefined', () => {
    expect(isFilled(undefined)).toBe(false);
    expect(isFilled({ slot: 'a', status: 'unknown', summary: '', citations: [] })).toBe(true);
    expect(isFilled({ slot: 'a', status: 'not_reached', summary: '', citations: [] })).toBe(true);
  });
});
