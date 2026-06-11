import { describe, it, expect } from 'vitest';
import {
  humanizeValidationIssue,
  triageCompetency,
  humanizeSource,
} from '@/app/capture/[code]/ProfileReviewPanel';

const chunkCite = [{ type: 'chunk' }] as never; // deriveEvidenceBand reads only .type


describe('humanizeValidationIssue', () => {
  const comps = [
    { statement: 'Intro to color' },
    { statement: 'Production file preparation' },
    {},
  ];

  it('maps a competency evidence path to a human label with the competency name', () => {
    expect(
      humanizeValidationIssue(
        ['competencies', 1, 'evidence_k'],
        'String must contain at least 1 character',
        comps,
      ),
    ).toBe('Competency #2 ("Production file preparation") — Know evidence: String must contain at least 1 character');
  });

  it('handles depth fields and a missing competency name', () => {
    expect(humanizeValidationIssue(['competencies', 2, 'd_depth'], 'Expected number', comps)).toBe(
      'Competency #3 — Do depth: Expected number',
    );
  });

  it('truncates a very long competency name', () => {
    const long = [{ statement: 'x'.repeat(80) }];
    const out = humanizeValidationIssue(['competencies', 0, 'evidence_u'], 'required', long);
    expect(out).toContain('…');
    expect(out).toContain('— Understand evidence:');
  });

  it('falls back to a prettified path for non-competency fields', () => {
    expect(humanizeValidationIssue(['overview', 'summary'], 'too short', comps)).toBe(
      'overview › summary: too short',
    );
  });

  it('returns just the message for an empty path', () => {
    expect(humanizeValidationIssue([], 'invalid', comps)).toBe('invalid');
  });
});

describe('triageCompetency', () => {
  it('(a) flags a high score resting on the instructor word (claimed band)', () => {
    const t = triageCompetency(
      { statement: 'X', u_depth: 2, d_depth: 4, source: 'instructor', citations: [] },
      null,
    );
    expect(t.flagged).toBe(true);
    expect(t.reason).toMatch(/your word/i);
  });

  it('(b) flags theory-without-craft (U high, D low) even when materials-cited', () => {
    const t = triageCompetency(
      { statement: 'X', u_depth: 4, d_depth: 1, source: 'materials', citations: chunkCite },
      null,
    );
    expect(t.flagged).toBe(true);
    expect(t.reason).toMatch(/theory without craft/i);
  });

  it('(b) flags craft-without-articulation (D high, U low)', () => {
    const t = triageCompetency(
      { statement: 'X', u_depth: 1, d_depth: 4, source: 'materials', citations: chunkCite },
      null,
    );
    expect(t.reason).toMatch(/craft without articulation/i);
  });

  it('(c) flags an AI-inferred competency', () => {
    const t = triageCompetency(
      { statement: 'X', u_depth: 2, d_depth: 2, source: 'inferred', citations: [] },
      null,
    );
    expect(t.flagged).toBe(true);
    expect(t.reason).toMatch(/inferred/i);
  });

  it('(d) flags a competency that carries central graded weight', () => {
    const t = triageCompetency(
      { statement: 'Color management', u_depth: 2, d_depth: 2, source: 'materials', citations: chunkCite },
      [{ competency: 'Color management', centrality: 'central' }],
    );
    expect(t.flagged).toBe(true);
    expect(t.reason).toMatch(/graded weight/i);
  });

  it('does NOT flag a well-evidenced, mid-scored, non-central competency', () => {
    const t = triageCompetency(
      { statement: 'X', u_depth: 2, d_depth: 2, source: 'materials', citations: chunkCite },
      [{ competency: 'Other', centrality: 'central' }],
    );
    expect(t.flagged).toBe(false);
    expect(t.reason).toBeNull();
  });
});

describe('humanizeSource', () => {
  it('maps sources to plain language', () => {
    expect(humanizeSource('instructor')).toBe('you said');
    expect(humanizeSource('materials')).toBe('found in materials');
    expect(humanizeSource('inferred')).toBe('AI inferred');
    expect(humanizeSource(undefined)).toBe('AI inferred');
  });
});
