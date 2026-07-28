import { describe, it, expect } from 'vitest';
import { flagMaterials } from '@/lib/capture/flag-materials';

const base = {
  id: 'x', fileName: 'a.pdf', extractionStatus: 'ok', indexingStatus: 'ready',
  ignored: false, autoSetAside: false, extractedText: 'hi', facultyNote: null,
} as const;

describe('flagMaterials', () => {
  it('flags a failed uploaded material as extraction-failed', () => {
    const r = flagMaterials([{ ...base, extractionStatus: 'failed', fileName: 'deck.pdf' }]);
    expect(r).toEqual([{ id: 'x', fileName: 'deck.pdf', kind: 'extraction-failed', facultyNote: null }]);
  });

  it('flags an auto-set-aside material as ferpa-held', () => {
    const r = flagMaterials([{ ...base, ignored: true, autoSetAside: true }]);
    expect(r[0]!.kind).toBe('ferpa-held');
  });

  it('does NOT flag a manual ignore (autoSetAside false)', () => {
    expect(flagMaterials([{ ...base, ignored: true, autoSetAside: false }])).toEqual([]);
  });

  it('flags a failed linked material as inaccessible-link, not extraction-failed', () => {
    const r = flagMaterials([{ ...base, fileName: 'Drive PDF: 1abc… (not accessible)', extractionStatus: 'failed', extractedText: null }]);
    expect(r[0]!.kind).toBe('inaccessible-link');
  });

  it('flags a skipped, empty linked material as inaccessible-link', () => {
    const r = flagMaterials([{ ...base, fileName: 'YouTube: X (inaccessible)', extractionStatus: 'ok', indexingStatus: 'skipped', extractedText: null }]);
    expect(r[0]!.kind).toBe('inaccessible-link');
  });

  it('does NOT flag a clean ok material', () => {
    expect(flagMaterials([base])).toEqual([]);
  });

  it('carries facultyNote through', () => {
    const r = flagMaterials([{ ...base, extractionStatus: 'failed', facultyNote: 'ok to skip' }]);
    expect(r[0]!.facultyNote).toBe('ok to skip');
  });
});
