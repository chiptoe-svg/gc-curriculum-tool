import { describe, it, expect } from 'vitest';
import {
  repeatCount, summarize, personaAction, parseJudge, parseModelSpec, type SimRun,
} from '@/scripts/capture/interview-sim-lib';

describe('repeatCount', () => {
  it('an identical question asked twice counts 1', () => {
    expect(repeatCount(['What do students submit for the plate project?', 'What do students submit for the plate project?'])).toBe(1);
  });

  it('counts a paraphrase at Jaccard >= 0.6 (case and punctuation ignored)', () => {
    expect(repeatCount([
      'In the plate project, what do students submit?',
      'What do students submit for the Plate Project at the end?',
    ])).toBe(1);
    // 5 shared of 7 tokens = 0.71; one more new word each side drops it under 0.6.
    expect(repeatCount([
      'In the plate project, what do students submit?',
      'What did students finally submit for the plate project at the end?',
    ])).toBe(0);
  });

  it('questions about different slots count 0', () => {
    expect(repeatCount([
      'What can students do when they leave the course?',
      'Which Illustrator skills do students arrive with on day one?',
      'When a print run fails, do students get another attempt?',
    ])).toBe(0);
  });

  it('three copies count 2; empty questions are ignored', () => {
    expect(repeatCount(['Why?', '', 'Why?', 'why', ''])).toBe(2);
  });
});

const run = (caseId: string, n: number, replyMs: number[], facts: Record<string, number | null>, finished?: boolean): SimRun => ({
  caseId,
  turns: Array.from({ length: n }, (_, i) => ({ question: `distinct question number ${i} about topic${i}`, kind: i === n - 1 ? 'recap' : 'question', replyMs: replyMs[i] ?? 1000 })),
  factsFoundAt: facts,
  ...(finished === undefined ? {} : { finished }),
});

describe('summarize', () => {
  it('medians, within-20 share, and recall at 15 and 20 with null as not found', () => {
    const runs = [
      run('a', 16, [1000, 3000, 2000], { f1: 3, f2: 16, f3: null }, true),
      run('b', 20, [5000], { f1: 15, f2: 20, f3: 21 }, false),
      run('c', 18, [4000], { f1: null }, true),
    ];
    const s = summarize(runs);
    expect(s.medianTurns).toBe(18);
    expect(s.finishedWithin20).toBeCloseTo(2 / 3);
    // 7 facts: by 15 → f1@3, f1@15 = 2; by 20 → + f2@16, f2@20 = 4.
    expect(s.factRecall15).toBeCloseTo(2 / 7);
    expect(s.factRecall20).toBeCloseTo(4 / 7);
    expect(s.repeats).toBe(0);
    // reply times: 54 values; most are the 1000 default, so the median is 1000.
    expect(s.medianReplyMs).toBe(1000);
  });

  it('median of an even count averages the middle two; answer_only turns are not counted as questions', () => {
    const r1: SimRun = { caseId: 'x', factsFoundAt: {}, turns: [
      { question: 'a b c', kind: 'question', replyMs: 2000 },
      { question: '', kind: 'answer_only', replyMs: 4000 },
    ] };
    const r2: SimRun = { caseId: 'y', factsFoundAt: {}, turns: [
      { question: 'a b c', kind: 'question', replyMs: 6000 },
      { question: 'a b c', kind: 'follow_up', replyMs: 8000 },
      { question: 'd e f', kind: 'recap', replyMs: 8000 },
    ] };
    const s = summarize([r1, r2]);
    expect(s.medianTurns).toBe(2);
    expect(s.medianReplyMs).toBe(6000);
    expect(s.repeats).toBe(1);
    // finished not given: a run finished when it asked the recap within 20 counted questions.
    expect(s.finishedWithin20).toBe(0.5);
    expect(s.factRecall15).toBe(0);
  });
});

describe('personaAction', () => {
  it('normal, terse and yes-sayer always answer; skipper skips every third question; asks-back asks back on 2, 6, 10', () => {
    expect([1, 2, 3, 4, 5, 6].map(n => personaAction('normal', n).action)).toEqual(Array(6).fill('answer'));
    expect([1, 2, 3, 4, 5, 6].map(n => personaAction('skipper', n).action)).toEqual(['answer', 'answer', 'skip', 'answer', 'answer', 'skip']);
    expect([1, 2, 3, 6].map(n => personaAction('asks-back', n).action)).toEqual(['answer', 'ask-back', 'answer', 'ask-back']);
    expect(personaAction('terse', 1).style).toMatch(/short/i);
  });
});

describe('parseJudge', () => {
  it('reads the JSON after a think block and code fence; unknown ids dropped, bad turns null, missing ids null', () => {
    const raw = '<think>hmm</think>\n```json\n{"f1": 4, "f2": null, "f3": 99, "zz": 2, "f4": "7"}\n```';
    expect(parseJudge(raw, ['f1', 'f2', 'f3', 'f4', 'f5'], 20)).toEqual({ f1: 4, f2: null, f3: null, f4: 7, f5: null });
  });

  it('all null when there is no JSON', () => {
    expect(parseJudge('no idea', ['f1'], 20)).toEqual({ f1: null });
  });
});

describe('parseModelSpec', () => {
  it('splits model and effort', () => {
    expect(parseModelSpec('qwen3.8-27b-fp8:off')).toEqual({ model: 'qwen3.8-27b-fp8', effort: 'off' });
    expect(parseModelSpec('gpt-6.1-terra')).toEqual({ model: 'gpt-6.1-terra', effort: undefined });
  });
});
