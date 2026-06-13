import { describe, it, expect } from 'vitest';
import { parseCourseCode, composeCourseCode } from '@/lib/courses/parse-course-code';

describe('parseCourseCode', () => {
  it('splits prefix / integer number / suffix', () => {
    expect(parseCourseCode('GC 3460')).toEqual({ prefix: 'GC', number: 3460, suffix: '' });
    expect(parseCourseCode('GC 4900ap')).toEqual({ prefix: 'GC', number: 4900, suffix: 'ap' });
    expect(parseCourseCode('GC 4990ta')).toEqual({ prefix: 'GC', number: 4990, suffix: 'ta' });
    expect(parseCourseCode('ACCT 2010')).toEqual({ prefix: 'ACCT', number: 2010, suffix: '' });
    expect(parseCourseCode('PKSC 1020')).toEqual({ prefix: 'PKSC', number: 1020, suffix: '' });
  });
  it('uppercases prefix, lowercases suffix, tolerates spacing', () => {
    expect(parseCourseCode('  gc3460  ')).toEqual({ prefix: 'GC', number: 3460, suffix: '' });
    expect(parseCourseCode('GC 4900AP')).toEqual({ prefix: 'GC', number: 4900, suffix: 'ap' });
  });
  it('returns null number for an unparseable code (no digit group)', () => {
    expect(parseCourseCode('NOTACODE')).toEqual({ prefix: '', number: null, suffix: '' });
    expect(parseCourseCode('')).toEqual({ prefix: '', number: null, suffix: '' });
  });
});

describe('composeCourseCode', () => {
  it('recomposes losslessly', () => {
    expect(composeCourseCode({ prefix: 'GC', number: 4900, suffix: 'ap' })).toBe('GC 4900ap');
    expect(composeCourseCode({ prefix: 'GC', number: 3460, suffix: '' })).toBe('GC 3460');
  });
  it('returns empty string when number is null', () => {
    expect(composeCourseCode({ prefix: '', number: null, suffix: '' })).toBe('');
  });
});
