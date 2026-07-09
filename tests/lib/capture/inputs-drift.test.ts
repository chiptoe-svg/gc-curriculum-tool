import { describe, it, expect } from 'vitest';
import { diffInputsVsSnapshot } from '@/lib/capture/inputs-drift';

const mat = (id: string, over: Record<string, unknown> = {}) => ({
  id, fileName: `${id}.pdf`, extractionStatus: 'ready', sizeBytes: 100, ignored: false, retiredAt: null, ...over,
}) as never;
const inputsMat = (id: string, over: Record<string, unknown> = {}) => ({
  id, fileName: `${id}.pdf`, extractionStatus: 'ready', sizeBytes: 100, ignored: false, ...over,
});
const meta = (materials: unknown[], scan: { canvasImportedAt: string | null; googleDocsScannedAt: string | null } = { canvasImportedAt: 'C1', googleDocsScannedAt: 'D1' }) =>
  ({ materials, scanPasses: scan } as never);
const course = (over: Record<string, unknown> = {}) => ({ canvasImportedAt: 'C1', ...over }) as never;

describe('diffInputsVsSnapshot', () => {
  it('reports added / removed / changed and no false drift on identical', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a'), inputsMat('b')]), [mat('a'), mat('b')], course());
    expect(d.available).toBe(true);
    expect(d.added).toHaveLength(0); expect(d.removed).toHaveLength(0); expect(d.changed).toHaveLength(0);
  });
  it('added = present now, absent in snapshot', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a')]), [mat('a'), mat('b')], course());
    expect(d.added.map(m => m.id)).toEqual(['b']);
  });
  it('removed = in snapshot, gone now (or retired)', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a'), inputsMat('b')]), [mat('a')], course());
    expect(d.removed.map(m => m.id)).toEqual(['b']);
  });
  it('changed = same id, status/size/ignored delta', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a', { sizeBytes: 100 })]), [mat('a', { sizeBytes: 250 })], course());
    expect(d.changed.map(c => c.id)).toEqual(['a']);
  });
  it('canvasChanged when the snapshot froze a canvas timestamp that differs now', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a')], { canvasImportedAt: 'C1', googleDocsScannedAt: 'D1' }), [mat('a')], course({ canvasImportedAt: 'C2' }));
    expect(d.canvasChanged).toBe(true);
  });
  it('does NOT claim canvas drift when the snapshot froze null (legacy/unknown)', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a')], { canvasImportedAt: null, googleDocsScannedAt: null }), [mat('a')], course({ canvasImportedAt: 'C9' }));
    expect(d.canvasChanged).toBe(false);
  });
  it('available=false for a legacy snapshot with no frozen materials', () => {
    const d = diffInputsVsSnapshot(meta([]), [mat('a')], course());
    expect(d.available).toBe(false);
  });
  it('treats a retired current material as removed', () => {
    const d = diffInputsVsSnapshot(meta([inputsMat('a')]), [mat('a', { retiredAt: new Date() })], course());
    expect(d.removed.map(m => m.id)).toEqual(['a']);
  });
});
