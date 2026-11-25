import { describe, it, expect } from 'vitest';
import { buildLedger, type LedgerEvent, type SlotRecord } from '../ledger';
import { play } from './helpers';

/** Ledgers built from asked turns go through checkTurn (play throws on an illegal turn). */
const built = (events: LedgerEvent[]) => play(null, events).ledger;

const rec = (slot: string, summary = 's', status: SlotRecord['status'] = 'filled_by_instructor'): SlotRecord => ({
  slot, status, summary, citations: [],
});

describe('buildLedger', () => {
  it('empty events give empty slots', () => {
    const l = built([]);
    expect(l.slots).toEqual({});
    expect(l.asked).toEqual([]);
    expect(l.anchors).toEqual([]);
    expect(l.finished).toBe(false);
  });

  it('a later record for the same slot replaces the earlier one', () => {
    const l = built([
      { type: 'record', record: rec('outcomes', 'first') },
      { type: 'record', record: rec('outcomes', 'second') },
    ]);
    expect(l.slots.outcomes?.summary).toBe('second');
  });

  it('skip sets the last-asked slot to unknown with "instructor skipped"', () => {
    const l = built([
      { type: 'asked', turn: { stage: 1, slot: 'outcomes', kind: 'question' } },
      { type: 'skip', slot: 'outcomes' },
    ]);
    expect(l.slots.outcomes?.status).toBe('unknown');
    expect(l.slots.outcomes?.summary).toBe('instructor skipped');
  });

  it('skip targets the last asked slot, not the slot named in the event', () => {
    const l = built([
      { type: 'asked', turn: { stage: 1, slot: 'outcomes', kind: 'question' } },
      { type: 'asked', turn: { stage: 1, slot: 'anchors', kind: 'question' } },
      { type: 'skip', slot: 'outcomes' },
    ]);
    expect(l.slots.anchors?.status).toBe('unknown');
    expect(l.slots.outcomes).toBeUndefined();
  });

  it('finish marks every unfilled non-stage-6 slot not_reached', () => {
    const l = built([
      { type: 'record', record: rec('outcomes') },
      { type: 'finish' },
    ]);
    expect(l.finished).toBe(true);
    expect(l.slots.outcomes?.status).toBe('filled_by_instructor');
    for (const s of ['anchors', 'conditions', 'reasoning_evidence', 'tests', 'revision', 'transfer', 'threshold', 'incoming', 'reteach', 'habits']) {
      expect(l.slots[s]?.status).toBe('not_reached');
    }
    expect(l.slots.recap).toBeUndefined();
    expect(l.slots.objectives).toBeUndefined();
  });

  it('anchors are parsed from the anchors summary, at most 2', () => {
    const l = built([
      { type: 'record', record: rec('anchors', ' Poster project \n\nFinal exam\nThird thing') },
    ]);
    expect(l.anchors).toEqual(['Poster project', 'Final exam']);
  });

  it('a skipped anchors record yields no anchors', () => {
    const l = built([
      { type: 'asked', turn: { stage: 1, slot: 'anchors', kind: 'question' } },
      { type: 'skip', slot: 'anchors' },
    ]);
    expect(l.anchors).toEqual([]);
  });

  it('skip after an answer_only turn marks the last counted slot', () => {
    const l = built([
      { type: 'asked', turn: { stage: 1, slot: 'outcomes', kind: 'question' } },
      { type: 'asked', turn: { stage: 1, slot: 'x', kind: 'answer_only' } },
      { type: 'skip', slot: 'x' },
    ]);
    expect(l.slots.outcomes?.status).toBe('unknown');
    expect(l.slots.x).toBeUndefined();
  });

  it('skip never erases an already recorded answer', () => {
    const l = built([
      { type: 'record', record: rec('anchors', 'A\nB') },
      { type: 'asked', turn: { stage: 1, slot: 'anchors', kind: 'follow_up' } },
      { type: 'skip', slot: 'anchors' },
    ]);
    expect(l.slots.anchors?.status).toBe('filled_by_instructor');
    expect(l.anchors).toEqual(['A', 'B']);
  });

  it('D: an anchors correction within stage 1 updates the anchors', () => {
    const l = built([
      { type: 'asked', turn: { stage: 1, slot: 'anchors', kind: 'question' } },
      { type: 'record', record: rec('anchors', 'Projects') },
      { type: 'asked', turn: { stage: 1, slot: 'anchors', kind: 'follow_up' } },
      { type: 'record', record: rec('anchors', 'Final project\nLab reports') },
    ]);
    expect(l.anchors).toEqual(['Final project', 'Lab reports']);
  });

  it('D: anchors freeze once a graded_on slot has been asked', () => {
    const l = built([
      { type: 'record', record: rec('outcomes') },
      { type: 'record', record: rec('anchors', 'A\nB') },
      { type: 'asked', turn: { stage: 2, slot: 'graded_on:A', kind: 'question' } },
      { type: 'record', record: rec('anchors', 'C') },
    ]);
    expect(l.anchors).toEqual(['A', 'B']);
  });

  it('closedThrough is monotonic and event-ordered', () => {
    const l = built([
      { type: 'record', record: rec('outcomes') }, { type: 'record', record: rec('anchors', 'A') },
    ]);
    expect(l.closedThrough).toBe(1);
  });
});
