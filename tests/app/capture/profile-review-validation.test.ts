import { describe, it, expect } from 'vitest';
import { humanizeValidationIssue } from '@/app/capture/[code]/ProfileReviewPanel';

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
