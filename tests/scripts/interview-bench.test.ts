/** Interview benchmark: pure helpers (no database, no model calls). */
import { describe, it, expect } from 'vitest';
import { loadCases, parseConfigs, renderTable, selectCases, summarize, userTurnsBefore, type CaseResult } from '@/scripts/capture/interview-bench';

const result = (over: Partial<CaseResult>): CaseResult => ({
  caseId: 'x', kind: 'files', materialToolCalls: 0, otherToolCalls: 0, chunkCitations: 0, instructorCitations: 0,
  question: '', costUsdCents: 0, uncachedPromptTokens: 0, cachedTokens: 0, completionTokens: 0, durationMs: 0, ...over,
});

describe('cases file', () => {
  const cases = loadCases();
  it('has unique ids, a session, an interviewer turn and a kind for every case', () => {
    expect(new Set(cases.map(c => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.session).toMatch(/^[0-9a-f]{8}$/);
      expect(c.turn).toBeGreaterThan(0);
      expect(['files', 'instructor']).toContain(c.kind);
    }
  });
  it('the quick set has both kinds', () => {
    const quick = selectCases(cases, { quick: true });
    expect(quick.some(c => c.kind === 'files')).toBe(true);
    expect(quick.some(c => c.kind === 'instructor')).toBe(true);
  });
});

describe('selectCases', () => {
  const cases = loadCases();
  it('picks named cases and rejects unknown ids', () => {
    expect(selectCases(cases, { ids: ['2070-104'] }).map(c => c.id)).toEqual(['2070-104']);
    expect(() => selectCases(cases, { ids: ['nope'] })).toThrow(/unknown case/);
  });
});

describe('parseConfigs', () => {
  it('defaults to the current setting', () => {
    expect(parseConfigs(undefined)).toEqual([{ label: 'current setting' }]);
  });
  it('reads model:effort pairs, effort optional', () => {
    expect(parseConfigs('gpt-6.1-sol:medium, gpt-6.1-terra')).toEqual([
      { model: 'gpt-6.1-sol', effort: 'medium', label: 'gpt-6.1-sol medium' },
      { model: 'gpt-6.1-terra', effort: undefined, label: 'gpt-6.1-terra (model default effort)' },
    ]);
  });
});

describe('summarize', () => {
  it('scores search and citing on files cases only, and leaves errors out of the rates', () => {
    const s = summarize('t', [
      result({ kind: 'files', materialToolCalls: 1, chunkCitations: 1, uncachedPromptTokens: 60, cachedTokens: 40, durationMs: 4000 }),
      result({ kind: 'files', materialToolCalls: 1, chunkCitations: 0, uncachedPromptTokens: 100, durationMs: 2000 }),
      result({ kind: 'instructor', materialToolCalls: 1, uncachedPromptTokens: 100, durationMs: 6000 }),
      result({ kind: 'files', error: 'boom' }),
    ]);
    expect(s).toMatchObject({ filesCases: 2, filesSearched: 2, filesCited: 1, instructorCases: 1, instructorSearched: 1, tokensIn: 300, errors: 1 });
    expect(s.cachedShare).toBeCloseTo(40 / 300);
    expect(s.secondsPerTurn).toBeCloseTo(4);
  });
});

describe('renderTable', () => {
  it('prints one row per setting', () => {
    const t = renderTable([summarize('gpt-6.1-sol medium', [result({ materialToolCalls: 1, chunkCitations: 1, uncachedPromptTokens: 1000 })])]);
    expect(t.split('\n')).toHaveLength(3);
    expect(t).toContain('| gpt-6.1-sol medium | 1/1 | 1/1 | 0/0 |');
  });
});

describe('userTurnsBefore', () => {
  const session = [
    { role: 'assistant', turnIndex: 104, content: 'q' },
    { role: 'user', turnIndex: 105, content: 'answer' },
    { role: 'assistant', turnIndex: 106, content: 'q2' },
  ];
  it('returns the instructor turn just before each interviewer turn', () => {
    expect(userTurnsBefore(session, [106])).toEqual([session[1]]);
  });
  it('rejects a turn that does not follow an instructor turn', () => {
    expect(() => userTurnsBefore(session, [105])).toThrow(/not an instructor turn/);
  });
});
