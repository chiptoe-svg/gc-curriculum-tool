import { describe, it, expect } from 'vitest';
import { applyNameRedactions, splitForNamePass } from '@/lib/privacy/align';

describe('applyNameRedactions — accepts name-only changes', () => {
  it('rebuilds from the input, keeping its exact whitespace', () => {
    const r = applyNameRedactions('Submitted by Jane Doe\n\nGreat  work.', 'Submitted by [student]\nGreat work.');
    expect(r).toEqual({ ok: true, text: 'Submitted by [student]\n\nGreat  work.', names: 1 });
  });

  it('accepts one placeholder per name word', () => {
    const r = applyNameRedactions('Posted by Jane Doe on May 2', 'Posted by [student] [student] on May 2');
    expect(r).toEqual({ ok: true, text: 'Posted by [student] [student] on May 2', names: 2 });
  });

  it("accepts a possessive ([student]'s)", () => {
    expect(applyNameRedactions("Read Smith's draft.", "Read [student]'s draft."))
      .toEqual({ ok: true, text: "Read [student]'s draft.", names: 1 });
  });

  it('accepts particles and hyphen/apostrophe names', () => {
    expect(applyNameRedactions("Ana de la Cruz and Mary-Jane O'Neil", '[student] and [student]'))
      .toEqual({ ok: true, text: '[student] and [student]', names: 2 });
  });

  it('accepts names inside a markdown table', () => {
    const r = applyNameRedactions('| Jane Doe | 95 |\n| Raj Patel | 88 |', '| [student] | 95 |\n| [student] | 88 |');
    expect(r).toEqual({ ok: true, text: '| [student] | 95 |\n| [student] | 88 |', names: 2 });
  });

  it('is idempotent on text that already holds placeholders', () => {
    const t = 'Feedback for [student] on C [student ID].';
    expect(applyNameRedactions(t, t)).toEqual({ ok: true, text: t, names: 0 });
  });
});

describe('applyNameRedactions — rejects anything else', () => {
  it('rejects a changed non-name word', () => {
    const r = applyNameRedactions('Submitted by Jane Doe\nThe rubric has five criteria.', 'Submitted by [student]\nThe rubric has four criteria.');
    expect(r.ok).toBe(false);
  });

  it('rejects a placeholder that replaces lowercase text', () => {
    expect(applyNameRedactions('submitted late by the student', '[student] late by the student').ok).toBe(false);
  });

  it('rejects truncated output', () => {
    expect(applyNameRedactions('Alpha beta gamma delta.', 'Alpha beta').ok).toBe(false);
  });

  it('rejects output whose length changed beyond tolerance', () => {
    const input = 'Week notes. '.repeat(100);
    expect(applyNameRedactions(input, input + 'Extra paragraph the model invented. '.repeat(10)).ok).toBe(false);
  });

  it('never puts material text in the failure reason', () => {
    const r = applyNameRedactions('Submitted by Jane Doe secretword', 'Submitted by [student] otherword');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).not.toContain('secretword');
      expect(r.reason).not.toContain('Jane');
    }
  });
});

describe('splitForNamePass', () => {
  it('splits on line boundaries and joins back to the input', () => {
    const text = Array.from({ length: 400 }, (_, i) => `Line ${i} about press sheets.`).join('\n');
    const chunks = splitForNamePass(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join('')).toBe(text);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1000);
  });

  it('hard-splits a line longer than the limit', () => {
    const text = 'x'.repeat(2500);
    const chunks = splitForNamePass(text, 1000);
    expect(chunks.map(c => c.length)).toEqual([1000, 1000, 500]);
    expect(chunks.join('')).toBe(text);
  });

  it('returns no chunks for empty text', () => {
    expect(splitForNamePass('')).toEqual([]);
  });
});
