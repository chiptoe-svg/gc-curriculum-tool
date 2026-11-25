import { describe, it, expect } from 'vitest';
import { buildLedger, type AskedTurn, type SlotRecord } from '../ledger';
import { engineState, checkTurn, settledCount, isFilled } from '../engine';
import type { EvidenceMap } from '../evidence-map';
import { STAGES } from '../stages';
import { play, exhaust } from './helpers';

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
/** Every asked turn goes through checkTurn (play throws on an illegal turn). */
const st = (events: Ev[], m: EvidenceMap | null = null) => play(m, events);
/** n legal counted questions, each re-asking the first open slot unanswered, so stage caps close stages. */
const counted = (n: number): Ev[] => exhaust(null, n);
/** Five legal follow-ups on distinct slots: two in stage 1, three in stage 2. */
const fiveFollowUps: Ev[] = [
  ask(1, 'outcomes', 'follow_up'), ask(1, 'anchors', 'follow_up'), rec('outcomes'), rec('anchors', 'A'),
  ask(2, 'graded_on:A', 'follow_up'), ask(2, 'conditions', 'follow_up'), ask(2, 'reasoning_evidence', 'follow_up'),
];

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
      ask(1, 'anchors'), ask(1, 'anchors', 'follow_up'),
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
    // Stored rows from before Task 9b (or a downgraded turn) can hold answer_only while open: built directly, not played.
    const ledger = buildLedger(null, [ask(1, 'outcomes', 'answer_only'), ask(1, 'outcomes')]);
    const state = engineState(null, ledger);
    expect(state.questionsAsked).toBe(1);
  });

  it('card counts once', () => {
    const { state } = st([
      rec('outcomes'), rec('anchors', 'A'), rec('graded_on:A'), rec('conditions'), rec('reasoning_evidence'), rec('tests'),
      rec('revision'), rec('transfer'), rec('threshold'), ask(4, 'incoming'),
    ]);
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
    const { state, ledger } = st([ask(1, 'outcomes'), rec('outcomes', 'x'), ask(1, 'outcomes', 'follow_up')]);
    expect(checkTurn(state, ledger, { stage: 1, slot: 'outcomes', kind: 'follow_up' }).ok).toBe(false);
    const fresh = st([ask(1, 'outcomes'), rec('outcomes', 'x')]);
    expect(checkTurn(fresh.state, fresh.ledger, { stage: 1, slot: 'outcomes', kind: 'follow_up' }).ok).toBe(true);
  });

  it('sixth follow-up overall is sent back', () => {
    const { state, ledger } = st(fiveFollowUps);
    expect(state.followUpsUsed).toBe(5);
    expect(state.stage).toBe(2);
    const r = checkTurn(state, ledger, { stage: 2, slot: 'tests', kind: 'follow_up' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sendBack).toContain('follow-ups');
  });

  it('Task 9b: answer_only is sent back while the interview is open, asking for the answer and the next question together', () => {
    const { state, ledger } = st([rec('outcomes')]);
    expect(checkTurn(state, ledger, { stage: 1, slot: 'anchors', kind: 'answer_only' })).toEqual({
      ok: false, sendBack: 'Answer the instructor in `say` and ask the next open question in this same turn.',
    });
  });

  it('Task 9b: answer_only is sent back while the recap is due or asked but unanswered', () => {
    for (const evs of [[{ type: 'finish' }], [{ type: 'finish' }, ask(6, 'recap', 'recap')]] as Ev[][]) {
      const { state, ledger } = st(evs);
      expect(state.done).toBe(false);
      expect(checkTurn(state, ledger, { stage: 6, slot: 'recap', kind: 'answer_only' }).ok).toBe(false);
    }
  });

  it('when a recap is due, a non-recap question is sent back', () => {
    const { state, ledger } = st([{ type: 'finish' }]);
    expect(checkTurn(state, ledger, { stage: 3, slot: 'revision', kind: 'question' }).ok).toBe(false);
    expect(checkTurn(state, ledger, { stage: 6, slot: 'recap', kind: 'recap' }).ok).toBe(true);
  });
});

describe('fix round 1', () => {
  it('1: re-ask of an asked-but-unrecorded slot is accepted even with 5 follow-ups used', () => {
    const { state, ledger } = st([...fiveFollowUps, ask(2, 'tests')]);
    expect(state.followUpsUsed).toBe(5);
    expect(checkTurn(state, ledger, { stage: 2, slot: 'tests', kind: 'question' })).toEqual({ ok: true });
  });

  const lateAnchors = (withAnchors: boolean): Ev[] => [
    rec('outcomes'), ask(1, 'anchors'), ask(1, 'anchors'), ask(1, 'anchors', 'follow_up'),
    ask(2, 'conditions'), rec('conditions'), ask(2, 'reasoning_evidence'), rec('reasoning_evidence'), ask(2, 'tests'), rec('tests'),
    ask(3, 'revision'),
    ...(withAnchors ? [rec('anchors', 'A\nB')] : []),
  ];
  it('2: late anchors do not reopen a closed stage', () => {
    const { state } = st(lateAnchors(true));
    expect(state.stage).toBe(3);
    expect(state.openSlots).toEqual(['revision', 'transfer', 'threshold']);
    expect(state.slotStatus['graded_on:A']).toBe('not_reached');
  });
  it('2: settledCount does not drop when late anchors arrive', () => {
    const before = st(lateAnchors(false));
    const after = st(lateAnchors(true));
    const b = settledCount(before.state, before.ledger);
    const a = settledCount(after.state, after.ledger);
    expect(a.settled / a.total).toBeGreaterThanOrEqual(b.settled / b.total);
  });

  it('4: counted turns after done are sent back; answer_only is allowed', () => {
    const { state, ledger } = st([{ type: 'finish' }, ask(6, 'recap', 'recap'), rec('recap')]);
    expect(state.done).toBe(true);
    for (const kind of ['question', 'follow_up', 'recap'] as const) {
      expect(checkTurn(state, ledger, { stage: 6, slot: 'recap', kind }).ok).toBe(false);
    }
    expect(checkTurn(state, ledger, { stage: 6, slot: 'recap', kind: 'answer_only' }).ok).toBe(true);
  });

  it('5: stage 6 cap forces the recap; one follow-up on recap in both paths', () => {
    const m = map(true);
    const evs: Ev[] = [
      rec('outcomes'), rec('anchors', 'A'), rec('graded_on:A'), rec('conditions'), rec('reasoning_evidence'), rec('tests'),
      rec('revision'), rec('transfer'), rec('threshold'), rec('incoming'), rec('reteach'), rec('habits'),
      ask(6, 'objectives'), ask(6, 'objectives', 'follow_up'), ask(6, 'objectives'),
    ];
    const { state, ledger } = st(evs, m);
    expect(state.mustRecap).toBe(true);
    expect(state.openSlots).toEqual(['recap']);
    expect(checkTurn(state, ledger, { stage: 6, slot: 'objectives', kind: 'question' }).ok).toBe(false);
    expect(checkTurn(state, ledger, { stage: 6, slot: 'recap', kind: 'recap' }).ok).toBe(true);
    expect(checkTurn(state, ledger, { stage: 6, slot: 'recap', kind: 'follow_up' }).ok).toBe(false); // no recap asked yet
    const afterRecap = st([...evs, ask(6, 'recap', 'recap')], m);
    expect(checkTurn(afterRecap.state, afterRecap.ledger, { stage: 6, slot: 'recap', kind: 'follow_up' }).ok).toBe(true);
    const after = st([...evs, ask(6, 'recap', 'recap'), ask(6, 'recap', 'follow_up')], m);
    expect(checkTurn(after.state, after.ledger, { stage: 6, slot: 'recap', kind: 'follow_up' }).ok).toBe(false);
    // post-Finish path agrees
    const fin = st([{ type: 'finish' }], null);
    expect(checkTurn(fin.state, fin.ledger, { stage: 6, slot: 'recap', kind: 'follow_up' }).ok).toBe(false);
    const fin1 = st([{ type: 'finish' }, ask(6, 'recap', 'recap')], null);
    expect(checkTurn(fin1.state, fin1.ledger, { stage: 6, slot: 'recap', kind: 'follow_up' }).ok).toBe(true);
    const fin2 = st([{ type: 'finish' }, ask(6, 'recap', 'recap'), ask(6, 'recap', 'follow_up')], null);
    expect(checkTurn(fin2.state, fin2.ledger, { stage: 6, slot: 'recap', kind: 'follow_up' }).ok).toBe(false);
  });
});

describe('fix round 2', () => {
  const closeStage2 = (fromMaterials: boolean): Ev[] => [
    rec('outcomes'), ask(1, 'anchors'), ask(1, 'anchors'), ask(1, 'anchors', 'follow_up'),
    ask(2, 'conditions'), rec('conditions'), ask(2, 'reasoning_evidence'), rec('reasoning_evidence'),
    fromMaterials
      ? { type: 'record', record: { slot: 'tests', status: 'filled_from_materials', summary: 'm', citations: [] } }
      : rec('tests'),
  ];
  for (const fromMaterials of [false, true]) {
    it(`A: anchors recorded before any stage-3 question do not reopen stage 2 (materials=${fromMaterials})`, () => {
      const before = st(closeStage2(fromMaterials));
      expect(before.state.stage).toBe(3);
      const after = st([...closeStage2(fromMaterials), rec('anchors', 'A\nB')]);
      expect(after.state.stage).toBe(3);
      expect(after.state.openSlots).toEqual(['revision', 'transfer', 'threshold']);
      expect(after.state.slotStatus['graded_on:A']).toBe('not_reached');
      const b = settledCount(before.state, before.ledger);
      const a = settledCount(after.state, after.ledger);
      expect(a.settled / a.total).toBeGreaterThanOrEqual(b.settled / b.total);
    });
  }

  it('B: a turn tagged with another stage is sent back (answer_only too, while open)', () => {
    const { state, ledger } = st([]);
    expect(checkTurn(state, ledger, { stage: 6, slot: 'recap', kind: 'recap' }).ok).toBe(false);
    expect(checkTurn(state, ledger, { stage: 3, slot: 'revision', kind: 'question' }).ok).toBe(false);
    // Task 9b: answer_only is no longer exempt while the interview is open.
    expect(checkTurn(state, ledger, { stage: 3, slot: 'revision', kind: 'answer_only' }).ok).toBe(false);
  });

  it('B: recap kind is refused unless a recap is due or stage 6 is active', () => {
    const { state, ledger } = st([]);
    const r = checkTurn(state, ledger, { stage: 1, slot: 'recap', kind: 'recap' });
    expect(r.ok).toBe(false);
  });

  it('C: follow_up on recap needs a prior recap turn when the 19-question limit forces the recap', () => {
    const { state, ledger } = st(counted(19));
    expect(state.mustRecap).toBe(true);
    expect(checkTurn(state, ledger, { stage: state.stage, slot: 'recap', kind: 'follow_up' }).ok).toBe(false);
    expect(checkTurn(state, ledger, { stage: state.stage, slot: 'recap', kind: 'recap' }).ok).toBe(true);
  });
});

describe('fix round 3', () => {
  it('D: settledCount stays monotonic when anchors are corrected in stage 1 and after they freeze', () => {
    const steps: Ev[] = [
      rec('outcomes'), ask(1, 'anchors'), rec('anchors', 'Projects'),
      rec('anchors', 'Final project\nLab reports'),
      ask(2, 'graded_on:Final project'), rec('graded_on:Final project'), rec('anchors', 'Other'),
    ];
    let prev = 0;
    const evs: Ev[] = [];
    for (const s of steps) {
      evs.push(s);
      const { state, ledger } = st(evs);
      const { settled, total } = settledCount(state, ledger);
      expect(settled / total).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = settled / total;
    }
    expect(st(evs).ledger.anchors).toEqual(['Final project', 'Lab reports']);
  });

  it('E1: only one recap-kind turn; a second is sent back with record-the-answer advice', () => {
    const { state, ledger } = st([{ type: 'finish' }, ask(6, 'recap', 'recap')]);
    const r = checkTurn(state, ledger, { stage: 6, slot: 'recap', kind: 'recap' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sendBack).toContain('Record the recap answer');
  });

  it('E1: recap follow-up is allowed once even with 5 follow-ups used, then the interview ends', () => {
    const base: Ev[] = [...fiveFollowUps, { type: 'finish' }, ask(6, 'recap', 'recap')];
    const a = st(base);
    expect(checkTurn(a.state, a.ledger, { stage: 6, slot: 'recap', kind: 'follow_up' }).ok).toBe(true);
    const b = st([...base, ask(6, 'recap', 'follow_up')]);
    expect(b.state.done).toBe(true);
    expect(b.state.slotStatus.recap).toBe('not_reached');
  });

  it('E2: reaching the hard cap is terminal, with the recap not_reached', () => {
    const { state } = st(counted(20));
    expect(state.questionsAsked).toBe(20);
    expect(state.done).toBe(true);
    expect(state.openSlots).toEqual([]);
    expect(state.slotStatus.recap).toBe('not_reached');
  });
});

describe('recap slot', () => {
  it('a recap-kind turn on another slot is sent back', () => {
    const { state, ledger } = st([{ type: 'finish' }]);
    expect(checkTurn(state, ledger, { stage: 6, slot: 'outcomes', kind: 'recap' }).ok).toBe(false);
  });
});

describe('random legal walks', () => {
  function rng(seed: number) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const ANCHOR_SETS = ['Projects', 'Final project\nLab reports', 'Poster\nExam', 'Portfolio'];
  it('2000 seeded walks always reach done within 20 counted questions, never stuck', () => {
    let corrections = 0;
    let frozenChecks = 0;
    for (let seed = 1; seed <= 2000; seed++) {
      const r = rng(seed);
      const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)]!;
      const m = r() < 0.5 ? map(true) : map(false);
      const events: Ev[] = [];
      let prevPct = 0;
      let prevStage = 1;
      const doneStages = new Set<number>();
      let frozen: string[] | null = null;
      for (let step = 0; step < 400; step++) {
        const ledger = buildLedger(m, events as never);
        const state = engineState(m, ledger);
        const { settled, total } = settledCount(state, ledger);
        expect(settled / total).toBeGreaterThanOrEqual(prevPct - 1e-9);
        prevPct = settled / total;
        // No stage reopens: the active stage never moves back, and a done stage stays done.
        expect(state.stage, `seed ${seed} step ${step} stage moved back`).toBeGreaterThanOrEqual(prevStage);
        prevStage = state.stage;
        for (const d of doneStages) expect(state.stageProgress[d - 1]!.status, `seed ${seed} stage ${d} reopened`).toBe('done');
        for (const p of state.stageProgress) if (p.status === 'done') doneStages.add(p.id);
        // Once any graded_on slot has been asked, the anchors never change again.
        if (frozen) {
          expect(ledger.anchors, `seed ${seed} step ${step} anchors changed after freeze`).toEqual(frozen);
          frozenChecks++;
        } else if (ledger.asked.some((t) => t.kind !== 'answer_only' && t.slot.startsWith('graded_on:'))) {
          frozen = [...ledger.anchors];
        }
        if (state.done) break;
        expect(state.questionsAsked).toBeLessThanOrEqual(20);
        const slots = [...state.allSlots, 'recap', 'bogus'];
        const legal: AskedTurn[] = [];
        for (const slot of slots) {
          for (const kind of ['question', 'follow_up', 'recap'] as const) {
            const turn = { stage: state.stage, slot, kind };
            if (checkTurn(state, ledger, turn).ok) legal.push(turn);
          }
        }
        expect(legal.length, `seed ${seed} step ${step} stuck`).toBeGreaterThan(0);
        // Task 9b: while open, no turn may go without a counted question.
        expect(checkTurn(state, ledger, { stage: state.stage, slot: state.openSlots[0] ?? 'recap', kind: 'answer_only' }).ok, `seed ${seed} step ${step} answer_only allowed while open`).toBe(false);
        const roll = r();
        if (step > 150 || roll < 0.6) {
          const turn = pick(legal);
          events.push({ type: 'asked', turn });
          if (r() < 0.7) events.push(rec(turn.slot, 'a\nb'));
          else if (r() < 0.3) events.push({ type: 'skip', slot: turn.slot });
        } else if (roll < 0.75) {
          events.push(rec(pick(state.allSlots.filter((s) => s !== 'recap')), 'a\nb'));
        } else if (roll < 0.85) {
          events.push(ask(state.stage, 'bogus', 'answer_only'));
        } else if (roll < 0.88 && step < 100) {
          events.push({ type: 'finish' });
        } else if (roll < 0.95) {
          // The instructor corrects (or first names) the anchors at a random point: a volunteered record.
          events.push(rec('anchors', pick(ANCHOR_SETS)));
          corrections++;
        }
      }
      const final = engineState(m, buildLedger(m, events as never));
      expect(final.done, `seed ${seed} not done`).toBe(true);
      expect(checkTurn(final, buildLedger(m, events as never), { stage: final.stage, slot: 'recap', kind: 'answer_only' }).ok).toBe(true);
      expect(final.questionsAsked).toBeLessThanOrEqual(20);
    }
    // The walk really exercises corrections and the post-freeze check.
    expect(corrections).toBeGreaterThan(1000);
    expect(frozenChecks).toBeGreaterThan(1000);
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
      ask(2, 'reasoning_evidence'), ask(2, 'tests'),
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

describe('fix round 4', () => {
  // Reachable order: stage 1 fills, the engine moves to stage 2, then the instructor corrects the anchors.
  const toStage2: Ev[] = [ask(1, 'outcomes'), rec('outcomes'), ask(1, 'anchors'), rec('anchors', 'Projects')];

  it('D: after stage 1 closes, a follow_up on anchors is sent back (not a stage-2 slot)', () => {
    const { state, ledger } = play(null, toStage2);
    expect(state.stage).toBe(2);
    const r = checkTurn(state, ledger, { stage: 2, slot: 'anchors', kind: 'follow_up' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.sendBack).toContain('conditions');
  });

  it('D: a volunteered anchors correction at stage 2 updates the anchors', () => {
    const { ledger, state } = play(null, [...toStage2, rec('anchors', 'Final project\nLab reports')]);
    expect(ledger.anchors).toEqual(['Final project', 'Lab reports']);
    expect(state.openSlots).toEqual(['graded_on:Final project', 'graded_on:Lab reports', 'conditions', 'reasoning_evidence', 'tests']);
  });

  it('D: a counted turn on conditions does not freeze the anchors', () => {
    const { ledger } = play(null, [...toStage2, ask(2, 'conditions'), rec('anchors', 'Final project\nLab reports')]);
    expect(ledger.anchors).toEqual(['Final project', 'Lab reports']);
  });

  it('D: once a graded_on slot is asked, the anchors freeze', () => {
    const { ledger } = play(null, [...toStage2, ask(2, 'graded_on:Projects'), rec('anchors', 'Final project\nLab reports')]);
    expect(ledger.anchors).toEqual(['Projects']);
  });

  it('D: once a graded_on slot is recorded, the anchors freeze', () => {
    const { ledger } = play(null, [...toStage2, rec('graded_on:Projects'), rec('anchors', 'Final project\nLab reports')]);
    expect(ledger.anchors).toEqual(['Projects']);
  });

  it('minor: a counted turn on a slot outside the current stage is sent back, naming the open slots', () => {
    const { state, ledger } = play(null, []);
    for (const kind of ['question', 'follow_up'] as const) {
      const r = checkTurn(state, ledger, { stage: 1, slot: 'graded_on:A', kind });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.sendBack).toContain('outcomes, anchors');
    }
    expect(checkTurn(state, ledger, { stage: 1, slot: 'graded_on:A', kind: 'answer_only' }).ok).toBe(false); // Task 9b
  });
});
