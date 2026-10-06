import { describe, it, expect } from 'vitest';
import {
  scrubIdentifiers,
  findResidualIdentifiers,
  countRedactionMarkers,
} from '@/lib/privacy/deterministic';

describe('scrubIdentifiers', () => {
  it('replaces every CUID with [student ID]', () => {
    expect(scrubIdentifiers('C12345678 and C87654321 submitted.', { keepEmails: false }))
      .toBe('[student ID] and [student ID] submitted.');
  });

  it('replaces emails in a non-syllabus file', () => {
    expect(scrubIdentifiers('Questions: jane.doe@g.clemson.edu', { keepEmails: false }))
      .toBe('Questions: [email]');
  });

  it('keeps emails in a syllabus but still replaces CUIDs', () => {
    expect(scrubIdentifiers('Instructor: prof@clemson.edu. Example ID C12345678.', { keepEmails: true }))
      .toBe('Instructor: prof@clemson.edu. Example ID [student ID].');
  });

  it('returns text with nothing to remove unchanged', () => {
    const text = 'Students learn halftone screening and dot gain in week 3.\n| Topic | Week |\n';
    expect(scrubIdentifiers(text, { keepEmails: false })).toBe(text);
  });

  it('leaves look-alikes alone (course codes, 7-digit numbers)', () => {
    const text = 'Course GC12345678 and C1234567 (seven digits).';
    expect(scrubIdentifiers(text, { keepEmails: false })).toBe(text);
  });

  it('is idempotent', () => {
    const once = scrubIdentifiers('C12345678 jane@x.edu', { keepEmails: false });
    expect(scrubIdentifiers(once, { keepEmails: false })).toBe(once);
  });
});

describe('findResidualIdentifiers', () => {
  it('finds distinct emails and CUIDs', () => {
    expect(findResidualIdentifiers('a@b.co C12345678 a@b.co').sort()).toEqual(['C12345678', 'a@b.co']);
  });
  it('finds nothing after a non-syllabus scrub', () => {
    const scrubbed = scrubIdentifiers('a@b.co C12345678', { keepEmails: false });
    expect(findResidualIdentifiers(scrubbed)).toEqual([]);
  });
});

describe('countRedactionMarkers', () => {
  it('counts each placeholder kind in the text', () => {
    expect(countRedactionMarkers('[student] met [student]; [student ID]; [email]'))
      .toEqual({ 'student-name': 2, 'student-id': 1, email: 1, ssn: 0 });
  });
});
