import { describe, it, expect, vi, beforeEach } from 'vitest';

const { selectLimit, updateSet, scrubForRecord } = vi.hoisted(() => ({
  selectLimit: vi.fn(),
  updateSet: vi.fn(),
  scrubForRecord: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  db: {
    select: () => ({ from: () => ({ where: () => ({ limit: selectLimit }) }) }),
    update: () => ({
      set: (patch: unknown) => {
        updateSet(patch);
        return { where: vi.fn(async () => undefined) };
      },
    }),
  },
}));
vi.mock('@/lib/privacy/scrub', () => ({ scrubForRecord }));

import { __mapMaterialRowForTest, updateExtractionResult } from '@/lib/db/course-materials-queries';

beforeEach(() => {
  selectLimit.mockReset();
  updateSet.mockReset();
  scrubForRecord.mockReset();
});

describe('mapMaterialRow — redactions', () => {
  it('maps the redactions column and defaults a missing value to null', () => {
    const base = { id: 'a', course_code: 'GC 1010', file_name: 'f', extracted_text: 'x' };
    const red = { counts: { 'student-name': 2 }, failedReason: null };
    expect(__mapMaterialRowForTest({ ...base, redactions: red }).redactions).toEqual(red);
    expect(__mapMaterialRowForTest(base).redactions).toBeNull();
  });
});

describe('updateExtractionResult — the single writer of extracted_text', () => {
  it('scrubs the text before writing it, with the row\'s file name', async () => {
    selectLimit.mockResolvedValue([{ fileName: 'Canvas File: critiques.pdf', extractedText: null, redactions: null }]);
    scrubForRecord.mockResolvedValue({ text: 'Submitted by [student]', redactions: { 'student-name': 1, 'student-id': 0, email: 0 } });
    const r = await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractionMethod: 'text', extractedText: 'Submitted by Jane Doe' });
    expect(scrubForRecord).toHaveBeenCalledWith('Submitted by Jane Doe', { fileName: 'Canvas File: critiques.pdf', isSyllabus: false });
    expect(updateSet).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({
      extractionStatus: 'ok',
      extractionMethod: 'text',
      extractedText: 'Submitted by [student]',
      redactions: { counts: { 'student-name': 1, 'student-id': 0, email: 0 }, failedReason: null },
    });
    expect(r).toEqual({ outcome: 'stored', extractedText: 'Submitted by [student]' });
  });

  it('marks a syllabus so its emails are kept', async () => {
    selectLimit.mockResolvedValue([{ fileName: 'Canvas: Syllabus', extractedText: null, redactions: null }]);
    scrubForRecord.mockResolvedValue({ text: 't', redactions: {} });
    await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: 't' });
    expect(scrubForRecord).toHaveBeenCalledWith('t', { fileName: 'Canvas: Syllabus', isSyllabus: true });
  });

  it('marks a syllabus via the is_syllabus column even when the file name does not say so (R4)', async () => {
    selectLimit.mockResolvedValue([{ fileName: 'GC 4800 course outline.pdf', isSyllabus: true, extractedText: null, redactions: null }]);
    scrubForRecord.mockResolvedValue({ text: 't', redactions: {} });
    await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: 't' });
    expect(scrubForRecord).toHaveBeenCalledWith('t', { fileName: 'GC 4800 course outline.pdf', isSyllabus: true });
  });

  it('stores NO text when the scrub fails: status failed, text cleared, reason recorded', async () => {
    selectLimit.mockResolvedValue([{ fileName: 'Canvas: Discussions', extractedText: 'Posted by Jane Doe on May 2', redactions: null }]);
    scrubForRecord.mockRejectedValue(new Error('privacy-scrub guard rejected chunk 1/1: text changed at input token 4'));
    const r = await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: 'Posted by Jane Doe on May 2' });
    expect(r).toEqual({ outcome: 'scrub_failed', extractedText: undefined, reason: 'privacy-scrub guard rejected chunk 1/1: text changed at input token 4' });
    expect(updateSet).toHaveBeenCalledOnce();
    expect(updateSet).toHaveBeenCalledWith({
      extractionStatus: 'failed',
      extractedText: null,
      redactions: { counts: {}, failedReason: 'privacy-scrub guard rejected chunk 1/1: text changed at input token 4' },
    });
    for (const [patch] of updateSet.mock.calls) expect(JSON.stringify(patch)).not.toContain('Jane Doe');
  });

  it('does not look up, scrub or write text when none is given', async () => {
    const r = await updateExtractionResult({ id: 'm1', extractionStatus: 'failed', extractionMethod: 'text' });
    expect(selectLimit).not.toHaveBeenCalled();
    expect(scrubForRecord).not.toHaveBeenCalled();
    expect(updateSet).toHaveBeenCalledWith({ extractionStatus: 'failed', extractionMethod: 'text' });
    expect(r).toEqual({ outcome: 'stored', extractedText: undefined });
  });

  it('does not re-scrub text that is already the scrubber\'s output (identical text, successful redactions)', async () => {
    const red = { counts: { 'student-name': 1, 'student-id': 0, email: 0 }, failedReason: null };
    selectLimit.mockResolvedValue([{ fileName: 'Canvas: Discussions', extractedText: 'Posted by [student] on May 2', redactions: red }]);
    const r = await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: 'Posted by [student] on May 2' });
    expect(scrubForRecord).not.toHaveBeenCalled();
    expect(r).toEqual({ outcome: 'stored', extractedText: 'Posted by [student] on May 2' });
    expect(updateSet).toHaveBeenCalledOnce();
    const patch = updateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.extractionStatus).toBe('ok');
    expect(patch.extractedText).not.toBeNull();
    expect('redactions' in patch ? patch.redactions : red).toEqual(red);
  });

  it('still scrubs identical text when the previous scrub failed or never ran (redactions null / failedReason set)', async () => {
    scrubForRecord.mockResolvedValue({ text: 'x', redactions: {} });
    selectLimit.mockResolvedValue([{ fileName: 'f.pdf', extractedText: 'x', redactions: null }]);
    await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: 'x' });
    selectLimit.mockResolvedValue([{ fileName: 'f.pdf', extractedText: 'x', redactions: { counts: {}, failedReason: 'boom' } }]);
    await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: 'x' });
    expect(scrubForRecord).toHaveBeenCalledTimes(2);
  });

  it('scrubs when the stored text differs from the input even if redactions are set', async () => {
    scrubForRecord.mockResolvedValue({ text: 'new', redactions: {} });
    selectLimit.mockResolvedValue([{ fileName: 'f.pdf', extractedText: 'old', redactions: { counts: {}, failedReason: null } }]);
    await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: 'new raw' });
    expect(scrubForRecord).toHaveBeenCalledOnce();
  });

  it('re-scrubs already-scrubbed text when rescrub is set (backfill catching names an earlier pass missed)', async () => {
    const red = { counts: { 'student-name': 1, 'student-id': 0, email: 0 }, failedReason: null };
    selectLimit.mockResolvedValue([{ fileName: 'roster.xlsx', extractedText: '[student], Raj Patel', redactions: red }]);
    scrubForRecord.mockResolvedValue({ text: '[student], [student]', redactions: { 'student-name': 2, 'student-id': 0, email: 0 } });
    const r = await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: '[student], Raj Patel', rescrub: true });
    expect(scrubForRecord).toHaveBeenCalledOnce();
    expect(r).toEqual({ outcome: 'stored', extractedText: '[student], [student]' });
  });

  it('keeps the existing scrubbed text when a rescrub fails, instead of clearing it', async () => {
    const red = { counts: { 'student-name': 1, 'student-id': 0, email: 0 }, failedReason: null };
    selectLimit.mockResolvedValue([{ fileName: 'roster.xlsx', extractedText: '[student], Raj Patel', redactions: red }]);
    scrubForRecord.mockRejectedValue(new Error('privacy-scrub call failed on chunk 1/1 (Error)'));
    const r = await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: '[student], Raj Patel', rescrub: true });
    expect(r).toEqual({ outcome: 'stored', extractedText: '[student], Raj Patel' });
    for (const [patch] of updateSet.mock.calls) expect((patch as Record<string, unknown>).extractedText).not.toBeNull();
  });

  it('throws when the material does not exist', async () => {
    selectLimit.mockResolvedValue([]);
    await expect(updateExtractionResult({ id: 'nope', extractionStatus: 'ok', extractedText: 'x' }))
      .rejects.toThrow(/material nope not found/);
    expect(updateSet).not.toHaveBeenCalled();
  });
});
