import { describe, it, expect } from 'vitest';
import { titleFromContentDisposition } from '@/lib/google-docs/fetch-doc';

describe('titleFromContentDisposition', () => {
  it('extracts the title from a plain filename="..." (and strips .txt)', () => {
    expect(
      titleFromContentDisposition('attachment; filename="GC 3460 Syllabus.txt"'),
    ).toBe('GC 3460 Syllabus');
  });

  it('strips .csv for sheet exports', () => {
    expect(
      titleFromContentDisposition('attachment; filename="Course Schedule.csv"'),
    ).toBe('Course Schedule');
  });

  it('prefers the RFC 5987 filename* form and percent-decodes it', () => {
    // Google sends both; filename* carries non-ASCII safely.
    const cd =
      "attachment; filename=\"Resumé.txt\"; filename*=UTF-8''R%C3%A9sum%C3%A9%20Draft.txt";
    expect(titleFromContentDisposition(cd)).toBe('Résumé Draft');
  });

  it('handles an unquoted filename', () => {
    expect(titleFromContentDisposition('attachment; filename=Notes.txt')).toBe('Notes');
  });

  it('returns null when the header is absent or has no filename', () => {
    expect(titleFromContentDisposition(null)).toBeNull();
    expect(titleFromContentDisposition('attachment')).toBeNull();
    expect(titleFromContentDisposition('inline')).toBeNull();
  });

  it('returns null for an empty filename (caller falls back to first line)', () => {
    expect(titleFromContentDisposition('attachment; filename=".txt"')).toBeNull();
    expect(titleFromContentDisposition('attachment; filename=""')).toBeNull();
  });

  it('caps very long titles at 100 chars', () => {
    const long = 'x'.repeat(250);
    const out = titleFromContentDisposition(`attachment; filename="${long}.txt"`);
    expect(out).toHaveLength(100);
  });
});
