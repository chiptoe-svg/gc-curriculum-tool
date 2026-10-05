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
    selectLimit.mockResolvedValue([{ fileName: 'Canvas File: critiques.pdf' }]);
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
    selectLimit.mockResolvedValue([{ fileName: 'Canvas: Syllabus' }]);
    scrubForRecord.mockResolvedValue({ text: 't', redactions: {} });
    await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: 't' });
    expect(scrubForRecord).toHaveBeenCalledWith('t', { fileName: 'Canvas: Syllabus', isSyllabus: true });
  });

  it('marks a syllabus via the is_syllabus column even when the file name does not say so (R4)', async () => {
    selectLimit.mockResolvedValue([{ fileName: 'GC 4800 course outline.pdf', isSyllabus: true }]);
    scrubForRecord.mockResolvedValue({ text: 't', redactions: {} });
    await updateExtractionResult({ id: 'm1', extractionStatus: 'ok', extractedText: 't' });
    expect(scrubForRecord).toHaveBeenCalledWith('t', { fileName: 'GC 4800 course outline.pdf', isSyllabus: true });
  });

  it('stores NO text when the scrub fails: status failed, text cleared, reason recorded', async () => {
    selectLimit.mockResolvedValue([{ fileName: 'Canvas: Discussions' }]);
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

  it('throws when the material does not exist', async () => {
    selectLimit.mockResolvedValue([]);
    await expect(updateExtractionResult({ id: 'nope', extractionStatus: 'ok', extractedText: 'x' }))
      .rejects.toThrow(/material nope not found/);
    expect(updateSet).not.toHaveBeenCalled();
  });
});
