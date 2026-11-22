import { describe, it, expect } from 'vitest';
import { findQuote, evidenceBreaks, stability, normalizeForQuote } from '@/scripts/bench/lib/evidence';

const SRC = [
  { id: 'syllabus', text: 'Students write a “design brief” for every project.\nCritique is held weekly – in studio.' },
  { id: 'rubric', text: 'Typography is assessed on kerning and hierarchy.' },
];

describe('normalizeForQuote', () => {
  it('lowercases, unifies quotes and dashes, collapses whitespace', () => {
    expect(normalizeForQuote('  “Design   Brief” – in\n studio ')).toBe('"design brief" - in studio');
  });
});

describe('findQuote', () => {
  it('matches across curly quotes, en dashes and line breaks', () => {
    expect(findQuote('write a "design brief" for every project', SRC)).toEqual({ found: true, sourceId: 'syllabus' });
    expect(findQuote('weekly - in studio', SRC)).toEqual({ found: true, sourceId: 'syllabus' });
    expect(findQuote('every project.\nCritique is held', SRC)).toEqual({ found: true, sourceId: 'syllabus' });
  });

  it('rejects a paraphrase', () => {
    expect(findQuote('students produce a short design proposal each term', SRC)).toEqual({ found: false, sourceId: null });
  });

  it('ignores quotes under 12 characters', () => {
    expect(findQuote('studio', SRC)).toEqual({ found: false, sourceId: null });
  });
});

describe('evidenceBreaks', () => {
  it('flags D3 with an excerpt not in any source', () => {
    const cell = { k: null, u: null, d: 3, excerpt: 'students present final portfolios to clients' };
    expect(evidenceBreaks(cell, SRC)).toEqual(['d']);
  });

  it('flags K2 and U1 when their excerpt is missing, and names each dim once', () => {
    const cell = { k: 2, u: 1, d: 0, excerpt: 'students present final portfolios to clients' };
    expect(evidenceBreaks(cell, SRC)).toEqual(['k', 'u']);
  });

  it('does not flag K1/U0/D0', () => {
    const cell = { k: 1, u: 0, d: 0, excerpt: '' };
    expect(evidenceBreaks(cell, SRC)).toEqual([]);
  });

  it('does not flag null K/U (foundational competencies)', () => {
    const cell = { k: null, u: null, d: 2, excerpt: 'Typography is assessed on kerning and hierarchy.' };
    expect(evidenceBreaks(cell, SRC)).toEqual([]);
  });

  it('passes a grounded excerpt', () => {
    const cell = { k: 3, u: 2, d: 3, excerpt: 'Typography is assessed on kerning and hierarchy.' };
    expect(evidenceBreaks(cell, SRC)).toEqual([]);
  });
});

describe('stability', () => {
  it('is 1 for identical runs', () => {
    const run = { k: 2, u: 1, d: 3 };
    expect(stability([run, { ...run }])).toBe(1);
  });

  it('counts a band change as disagreement, not a raw-number change within a band', () => {
    // k 1 vs 2 are both band "low"; d 3 vs 4 cross into "working"/"high".
    expect(stability([{ k: 1, u: 1, d: 3 }, { k: 2, u: 1, d: 4 }])).toBeCloseTo(2 / 3, 10);
  });

  it('is 2/3 when one of three dims differs in band (role-judge definition)', () => {
    expect(stability([{ k: 2, u: 1, d: 3 }, { k: 2, u: 1, d: 4 }])).toBeCloseTo(2 / 3, 10);
  });

  it('treats null as band "none" like role-judge does', () => {
    expect(stability([{ k: null, u: 0, d: 0 }, { k: 0, u: 0, d: 0 }])).toBe(1);
  });
});
