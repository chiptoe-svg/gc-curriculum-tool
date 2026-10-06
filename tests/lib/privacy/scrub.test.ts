import { describe, it, expect } from 'vitest';
import { scrubForRecord } from '@/lib/privacy/scrub';

// Owner, 2026-10-06: remove only emails, SSNs and CU ID numbers. Names stay:
// an automatic name pass replaced ordinary words ("Creative", "Production")
// and would remove inventors, historical figures and industry leaders.
describe('scrubForRecord', () => {
  it('replaces CU IDs, SSNs and emails', async () => {
    const r = await scrubForRecord('ID C12345678, SSN 123-45-6789, mail jdoe@clemson.edu', { fileName: 'roster.xlsx', isSyllabus: false });
    expect(r.text).toBe('ID [student ID], SSN [SSN], mail [email]');
    expect(r.redactions).toEqual({ 'student-name': 0, 'student-id': 1, email: 1, ssn: 1 });
  });

  it('keeps emails in a syllabus but still removes IDs and SSNs there', async () => {
    const r = await scrubForRecord('Instructor: prof@clemson.edu. C12345678. 123-45-6789', { fileName: 'Canvas: Syllabus', isSyllabus: true });
    expect(r.text).toBe('Instructor: prof@clemson.edu. [student ID]. [SSN]');
  });

  it('never removes names, job titles or ordinary capitalised words', async () => {
    const text = 'Submitted by Jane Doe. Gutenberg and Steve Jobs; Creative Agency; Production / Account Management.';
    const r = await scrubForRecord(text, { fileName: 'Canvas: Discussions', isSyllabus: false });
    expect(r.text).toBe(text);
  });

  it('leaves numbers that are not SSN-shaped alone (phone, ISBN, dates)', async () => {
    const text = 'Call 864-656-3447, ISBN 978-0-13-468599-1, due 2026-10-06.';
    const r = await scrubForRecord(text, { fileName: 'notes.pdf', isSyllabus: false });
    expect(r.text).toBe(text);
  });
});
