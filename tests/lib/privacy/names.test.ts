import { describe, it, expect } from 'vitest';
import { acceptNames, redactNames, splitForNamePass } from '@/lib/privacy/names';

describe('acceptNames', () => {
  it('accepts capitalised names of 1-6 tokens that occur whole-word in the chunk', () => {
    const chunk = 'Submitted by Jane Doe. Ana de la Cruz replied.';
    expect(acceptNames(chunk, ['Jane Doe', 'Jane', 'Ana de la Cruz'])).toEqual({
      accepted: ['Jane Doe', 'Jane', 'Ana de la Cruz'], ignored: 0,
    });
  });

  it('ignores names not present verbatim, lowercase names, too-long names and blanks', () => {
    const chunk = 'Submitted by Jane Doe. Janet wrote back. the student said hi.';
    const r = acceptNames(chunk, ['Raj Patel', 'jane doe', 'Jan', 'student', '', '  ', 'A B C D E F G', '[student]']);
    expect(r).toEqual({ accepted: [], ignored: 8 });
  });

  it('trims trailing punctuation from a listed name', () => {
    expect(acceptNames('Thanks, Jane.', ['Jane.'])).toEqual({ accepted: ['Jane'], ignored: 0 });
  });

  it('ignores a name that spans a line break', () => {
    expect(acceptNames('Jane\nDoe', ['Jane\nDoe'])).toEqual({ accepted: [], ignored: 1 });
  });

  it('trims surrounding whitespace and de-duplicates', () => {
    expect(acceptNames('Posted by Raj Patel', [' Raj Patel ', 'Raj Patel'])).toEqual({ accepted: ['Raj Patel'], ignored: 0 });
  });
});

describe('redactNames', () => {
  it('replaces every whole-word, case-sensitive occurrence and keeps the possessive ending', () => {
    const text = "Jane's poster. Feedback for Jane: good. Janet and jane are someone else. Jane";
    expect(redactNames(text, ['Jane'])).toBe("[student]'s poster. Feedback for [student]: good. Janet and jane are someone else. [student]");
  });

  it('replaces the longest name first so a full name becomes one placeholder', () => {
    expect(redactNames('Jane Doe wrote; Jane replied; Doe agreed.', ['Jane', 'Doe', 'Jane Doe']))
      .toBe('[student] wrote; [student] replied; [student] agreed.');
  });

  it('changes no other byte of the text', () => {
    const text = '| Name | Score |\n|---|---|\n| Jane Doe |  95 |\r\n\tRaj Patel’s  draft — ok done.  ';
    const out = redactNames(text, ['Jane Doe', 'Raj Patel']);
    expect(out).toBe('| Name | Score |\n|---|---|\n| [student] |  95 |\r\n\t[student]’s  draft — ok done.  ');
    // Removing the placeholders from both sides leaves identical text.
    expect(out.split('[student]').join('')).toBe(text.split('Jane Doe').join('').split('Raj Patel').join(''));
  });

  it('redacts the whole hyphenated name when only one part is listed', () => {
    expect(redactNames('Submitted by Mary-Jane Smith.', ['Mary'])).toBe('Submitted by [student] Smith.');
    expect(redactNames('Submitted by Mary-Jane Smith.', ['Jane'])).toBe('Submitted by [student] Smith.');
    expect(redactNames('Garcia-Lopez-Ruiz wrote', ['Lopez'])).toBe('[student] wrote');
  });

  it('does not swallow lowercase hyphenated words next to a name', () => {
    expect(redactNames('Jane-designed poster, self-Jane', ['Jane'])).toBe('[student]-designed poster, self-[student]');
  });

  it('treats regex metacharacters in names literally', () => {
    expect(redactNames('J. Doe and JX Doe', ['J. Doe'])).toBe('[student] and JX Doe');
  });

  it('returns the text unchanged for an empty list', () => {
    expect(redactNames('Nothing here', [])).toBe('Nothing here');
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
