import { describe, it, expect } from 'vitest';
import { anchorFallback, anchorTitle, buildLedger, topGradedWork, type LedgerEvent, type SlotRecord } from '../ledger';
import { play } from './helpers';
import type { EvidenceMap } from '../evidence-map';

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

  it('anchor lines lose leading bullets and numbering', () => {
    for (const [summary, want] of [
      ['- Poster project\n* Final exam', ['Poster project', 'Final exam']],
      ['• Poster project\n1. Final exam', ['Poster project', 'Final exam']],
      ['1) Poster project\n2) Final exam', ['Poster project', 'Final exam']],
      ['10. Press Run Report\n- 2024 Annual', ['Press Run Report', '2024 Annual']],
    ] as const) {
      expect(built([{ type: 'record', record: rec('anchors', summary) }]).anchors).toEqual(want);
    }
  });

  it('a skipped anchors record yields no anchors', () => {
    const l = built([
      { type: 'asked', turn: { stage: 1, slot: 'anchors', kind: 'question' } },
      { type: 'skip', slot: 'anchors' },
    ]);
    expect(l.anchors).toEqual([]);
  });

  it('skip after an answer_only turn marks the last counted slot', () => {
    // answer_only is illegal while open since Task 9b, but stored rows can still hold one: built directly.
    const l = buildLedger(null, [
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

const gw = (title: string, weight: string | null) => ({ title, weight, deliverables: null, rubric_criteria: [], source: 'c' });
const mapWith = (graded: EvidenceMap['graded_work']): EvidenceMap => ({
  summary: '', graded_work: graded, tests: [], competencies: [], assumed_skills: [], objectives: [], conflicts: [], unreadable: [],
});

describe('Task 9b fix 3: anchors normalize to evidence-map titles', () => {
  const m = mapWith([gw('Final portfolio', '20%'), gw('Press Run Report', '30%'), gw('Exam 1', '10%')]);
  const anchorsFor = (summary: string) => buildLedger(m, [{ type: 'record', record: rec('anchors', summary) }]).anchors;

  it('a sentence that contains a map title becomes that title', () => {
    expect(anchorsFor('The final portfolio, which is worth 20%')).toEqual(['Final portfolio']);
  });

  it('a line contained in a map title becomes the title (case-insensitive), after bullet stripping', () => {
    expect(anchorsFor('- press run\n2. FINAL PORTFOLIO')).toEqual(['Press Run Report', 'Final portfolio']);
  });

  it('unmatched lines are kept, trimmed and capped at 80 characters', () => {
    const long = 'The two projects that carry the course are the 2-Color Flexo label and the instructor considers it central';
    const got = anchorsFor(`  Studio critique  \n${long}`);
    expect(got[0]).toBe('Studio critique');
    expect(got[1]).toBe(long.slice(0, 80).trim());
    expect(got[1]!.length).toBeLessThanOrEqual(80);
  });

  it('two lines that match the same title give it once', () => {
    expect(anchorsFor('Final portfolio\nthe final portfolio (20%)\nExam 1')).toEqual(['Final portfolio', 'Exam 1']);
  });

  it('without a map, lines are only stripped and capped', () => {
    expect(buildLedger(null, [{ type: 'record', record: rec('anchors', 'The final portfolio, which is worth 20%') }]).anchors)
      .toEqual(['The final portfolio, which is worth 20%']);
  });
});

describe('Task 9b fix 2: anchor fallback from the map', () => {
  const m = mapWith([gw('Quizzes', '10%'), gw('Plate Project', '25%'), gw('Press Run Report', '30%'), gw('Lab notes', null)]);
  const closeStage1: LedgerEvent[] = [
    { type: 'record', record: rec('outcomes') },
    { type: 'record', record: rec('anchors', 'instructor did not know', 'unknown') },
  ];

  it('topGradedWork orders by the leading number of the weight, ties and missing weights in map order', () => {
    expect(topGradedWork(m)).toEqual(['Press Run Report', 'Plate Project']);
    expect(topGradedWork(mapWith([gw('A', null), gw('B', null), gw('C', null)]))).toEqual(['A', 'B']);
    expect(topGradedWork(mapWith([gw('A', '20 points'), gw('B', '20%'), gw('C', null)]))).toEqual(['A', 'B']);
    expect(topGradedWork(mapWith([gw('A', null), gw('B', '5%')]))).toEqual(['B', 'A']);
  });

  it('applies when stage 1 closed with anchors unknown and the map has graded work', () => {
    expect(anchorFallback(m, buildLedger(m, closeStage1))).toBe('Press Run Report\nPlate Project');
  });

  it('applies when stage 1 closed at its cap with anchors never recorded', () => {
    const evs: LedgerEvent[] = [
      { type: 'asked', turn: { stage: 1, slot: 'outcomes', kind: 'question' } }, { type: 'record', record: rec('outcomes') },
      { type: 'asked', turn: { stage: 1, slot: 'anchors', kind: 'question' } },
      { type: 'asked', turn: { stage: 1, slot: 'anchors', kind: 'follow_up' } },
    ];
    expect(anchorFallback(m, buildLedger(m, evs))).toBe('Press Run Report\nPlate Project');
  });

  it('the fallback record sets the anchors and opens their graded_on slots in stage 2', () => {
    const l = buildLedger(m, [...closeStage1, { type: 'record', record: rec('anchors', anchorFallback(m, buildLedger(m, closeStage1))!, 'filled_from_materials') }]);
    expect(l.anchors).toEqual(['Press Run Report', 'Plate Project']);
    expect(l.closedThrough).toBe(1);
    expect(anchorFallback(m, l)).toBeNull();
  });

  it('does not apply while stage 1 is open, when the instructor named anchors, without graded work, or after Finish', () => {
    expect(anchorFallback(m, buildLedger(m, [{ type: 'record', record: rec('anchors', 'x', 'unknown') }]))).toBeNull();
    expect(anchorFallback(m, buildLedger(m, [{ type: 'record', record: rec('outcomes') }, { type: 'record', record: rec('anchors', 'Quizzes') }]))).toBeNull();
    expect(anchorFallback(mapWith([]), buildLedger(mapWith([]), closeStage1))).toBeNull();
    expect(anchorFallback(null, buildLedger(null, closeStage1))).toBeNull();
    expect(anchorFallback(m, buildLedger(m, [{ type: 'finish' }]))).toBeNull();
  });
});

describe('Task 9b fix round 1', () => {
  const gwr = (title: string, weight: string | null, rubric: string[] = [], deliverables: string | null = null) =>
    ({ title, weight, deliverables, rubric_criteria: rubric, source: 'c' });

  it('B: ranks by share — a % is its own share, points are a share of all point weights', () => {
    // Points total 400: A = 25%, C = 75%. B is 30%. Before: raw numbers put C (300) and A (100) first.
    expect(topGradedWork(mapWith([gwr('A', '100 pts'), gwr('B', '30%'), gwr('C', '300 points')]))).toEqual(['C', 'B']);
    expect(topGradedWork(mapWith([gwr('Exam 1', '100 pts'), gwr('Lab', '40%'), gwr('Exam 2', '100 pts'), gwr('Quiz', '400 pts')]))).toEqual(['Quiz', 'Lab']);
  });

  it('B: a rubric\'d project within 5 points of share beats heavier exams; the exams are not dropped', () => {
    const m = mapWith([gwr('Exam 1', '30%'), gwr('Exam 2', '30%'), gwr('Plate Project', '27%', ['registration'])]);
    expect(topGradedWork(m)).toEqual(['Plate Project', 'Exam 1']);
    const d = mapWith([gwr('Exam 1', '30%'), gwr('Report', '26%', [], 'a written report')]);
    expect(topGradedWork(d)).toEqual(['Report', 'Exam 1']);
    // Outside 5 points the heavier exam keeps its place.
    expect(topGradedWork(mapWith([gwr('Exam 1', '40%'), gwr('Plate Project', '27%', ['registration'])]))).toEqual(['Exam 1', 'Plate Project']);
  });

  it('B: unweighted items rank last; all unweighted keep map order', () => {
    expect(topGradedWork(mapWith([gwr('A', null, ['r']), gwr('B', '5%')]))).toEqual(['B', 'A']);
    expect(topGradedWork(mapWith([gwr('A', null), gwr('B', null, ['r']), gwr('C', null)]))).toEqual(['A', 'B']);
  });

  it('C: anchorTitle strips a [A6]-style prefix, trims and caps at 80', () => {
    expect(anchorTitle('[B6] Final 4/Color NANO Screen Printing Lab Report')).toBe('Final 4/Color NANO Screen Printing Lab Report');
    expect(anchorTitle('  [12]  Exam 1 ')).toBe('Exam 1');
    expect(anchorTitle('[ab] keep')).toBe('[ab] keep');
    expect(anchorTitle('x'.repeat(100))).toHaveLength(80);
  });

  it('C: matched, unmatched and fallback anchors are clean, short titles', () => {
    const long = '[B6] Final 4/Color NANO Screen Printing Lab Report and Final Print Submission Guidelines and Details';
    const m = mapWith([gwr(long, '100 pts'), gwr('[A6] Final Lab Report for Cylinder production', '100 pts')]);
    const named = buildLedger(m, [{ type: 'record', record: rec('anchors', 'final 4/color NANO screen printing lab report\n[A6] Final Lab Report for Cylinder production') }]).anchors;
    expect(named).toEqual([anchorTitle(long), 'Final Lab Report for Cylinder production']);
    expect(named.every((a) => a.length <= 80 && !a.startsWith('['))).toBe(true);
    expect(topGradedWork(m)).toEqual([anchorTitle(long), 'Final Lab Report for Cylinder production']);
    expect(buildLedger(null, [{ type: 'record', record: rec('anchors', '[C3] Poster') }]).anchors).toEqual(['Poster']);
  });
});
