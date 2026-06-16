import { describe, it, expect } from 'vitest';
import { safeFilename, courseSlug } from '@/lib/storage/local-storage';

describe('safeFilename', () => {
  it('leaves an ordinary filename intact', () => {
    expect(safeFilename('syllabus.pdf')).toBe('syllabus.pdf');
    expect(safeFilename('Lecture-3_notes.pdf')).toBe('Lecture-3_notes.pdf');
  });

  it('replaces unsafe characters with underscore', () => {
    expect(safeFilename('my file (final).pdf')).toBe('my_file__final_.pdf');
    expect(safeFilename('a/b/c.pdf')).toBe('a_b_c.pdf');
  });

  it('collapses ".." (and longer dot runs) so the output never contains ".." — GC 2400 regression', () => {
    // These are the real-world cases that 503'd: a double dot anywhere in the name.
    expect(safeFilename('Lecture 3..pdf')).toBe('Lecture_3.pdf');
    expect(safeFilename('Substrates v1..2.pdf')).toBe('Substrates_v1.2.pdf');
    expect(safeFilename('notes...pdf')).toBe('notes.pdf');
    for (const name of ['Lecture 3..pdf', 'Substrates v1..2.pdf', 'notes...pdf', '..hidden.pdf', 'a..b..c..pdf']) {
      expect(safeFilename(name).includes('..')).toBe(false);
    }
  });

  it('strips leading dots', () => {
    expect(safeFilename('.hidden.pdf')).toBe('hidden.pdf');
    expect(safeFilename('..pdf')).toBe('pdf');
  });

  it('never returns empty', () => {
    expect(safeFilename('')).toBe('_');
    expect(safeFilename('...')).toBe('_');
    expect(safeFilename('@#$%')).toBe('____');
  });

  it('produces a storage key (courseSlug/ts-name) that contains no traversal sequence', () => {
    const key = `${courseSlug('GC 2400')}/${1718000000000}-${safeFilename('Substrates v1..2.pdf')}`;
    expect(key.includes('..')).toBe(false);
    expect(key.startsWith('gc-2400/')).toBe(true);
  });
});
