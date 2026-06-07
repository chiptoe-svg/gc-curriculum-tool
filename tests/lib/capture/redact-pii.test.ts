import { describe, it, expect } from 'vitest';
import { redactPii, redactPiiDeep } from '@/lib/capture/redact-pii';

describe('redactPii', () => {
  it('redacts Clemson CUIDs', () => {
    expect(redactPii('Student C12345678 did well.')).toBe('Student [redacted] did well.');
  });

  it('redacts email addresses', () => {
    expect(redactPii('Reach jane.doe@clemson.edu for notes.')).toBe('Reach [redacted] for notes.');
  });

  it('redacts attributed names but keeps the verb', () => {
    expect(redactPii('Submitted by Jane Smith on time.')).toBe('Submitted by [redacted] on time.');
    expect(redactPii('Posted by Alex Kim yesterday.')).toBe('Posted by [redacted] yesterday.');
  });

  it('leaves benign curriculum prose untouched', () => {
    const text = 'Students learn halftone screening and dot gain in week 3.';
    expect(redactPii(text)).toBe(text);
  });
});

describe('redactPiiDeep', () => {
  it('scrubs strings nested in objects and arrays without mutating the input', () => {
    const input = {
      narrative: 'Submitted by Jane Smith; contact jane@clemson.edu (C12345678).',
      evidence: ['clean line', 'another C87654321 here'],
      score: 4,
      nested: { note: 'fine', flag: true, missing: null },
    };
    const out = redactPiiDeep(input);
    expect(out.narrative).toBe('Submitted by [redacted]; contact [redacted] ([redacted]).');
    expect(out.evidence).toEqual(['clean line', 'another [redacted] here']);
    expect(out.score).toBe(4);
    expect(out.nested).toEqual({ note: 'fine', flag: true, missing: null });
    // input untouched
    expect(input.narrative).toContain('Jane Smith');
  });
});
