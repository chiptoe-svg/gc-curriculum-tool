import { describe, it, expect } from 'vitest';
import { diffInputsVsSnapshot } from '@/lib/capture/inputs-drift';
import { hashText } from '@/lib/capture/text-hash';

const live = (text: string | null, over: Record<string, unknown> = {}) => ({
  id: 'a', fileName: 'a.pdf', extractionStatus: 'ok', sizeBytes: 10, ignored: false, retiredAt: null, extractedText: text, ...over,
}) as never;
const frozen = (over: Record<string, unknown> = {}) => ({
  id: 'a', fileName: 'a.pdf', extractionStatus: 'ok', sizeBytes: 10, ignored: false, ...over,
});
const meta = (m: unknown) => ({ materials: [m], scanPasses: { canvasImportedAt: null, googleDocsScannedAt: null } } as never);
const course = { canvasImportedAt: null };

describe('hashText', () => {
  it('is null for empty text and stable otherwise', () => {
    expect(hashText(null)).toBeNull();
    expect(hashText('')).toBeNull();
    expect(hashText('abc')).toBe(hashText('abc'));
    expect(hashText('abc')).not.toBe(hashText('abd'));
  });
});

describe('diffInputsVsSnapshot with a text fingerprint', () => {
  it('same size, different text counts as changed', () => {
    const d = diffInputsVsSnapshot(meta(frozen({ textHash: hashText('a') })), [live('b')], course);
    expect(d.changed.map(c => c.id)).toEqual(['a']);
  });

  it('same text is not changed', () => {
    const d = diffInputsVsSnapshot(meta(frozen({ textHash: hashText('a') })), [live('a')], course);
    expect(d.changed).toEqual([]);
  });

  it('baseline without textHash falls back to status and size', () => {
    const d = diffInputsVsSnapshot(meta(frozen()), [live('b')], course);
    expect(d.changed).toEqual([]);
  });
});
