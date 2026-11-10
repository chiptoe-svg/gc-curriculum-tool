import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});
vi.mock('@/lib/db/course-materials-queries', () => ({ updateMaterialTier: vi.fn(async () => {}) }));

import { tierLinkedMaterial } from '@/lib/capture/material-tier';
import { getProviderForFunction } from '@/lib/ai/provider';
import { updateMaterialTier } from '@/lib/db/course-materials-queries';
import { loadPrompt } from '@/lib/ai/prompts/load';

beforeEach(() => { vi.mocked(getProviderForFunction).mockReset(); vi.mocked(updateMaterialTier).mockClear(); });

const video = { fileName: 'YouTube: Soft Proofing in Photoshop', mimeType: 'text/plain', sizeBytes: 1909, text: 'soft proofing is an important step '.repeat(40) };

// 2026-11-09 (owner): linked videos and documents were saved with no tier, so
// every one was read in full. They now go through the classifier, with their
// opening text, before they are queued.
describe('tierLinkedMaterial', () => {
  it('classifies with the opening text and stores the tier', async () => {
    const complete = vi.fn(async (a: { validate: (r: unknown) => unknown }) => ({ data: a.validate({ tier: 'middle' }) }));
    vi.mocked(getProviderForFunction).mockResolvedValueOnce({ complete } as never);
    expect(await tierLinkedMaterial('m1', video, 'GC 3460')).toBe('middle');
    const msg = (complete.mock.calls[0]![0] as unknown as { userMessage: string }).userMessage;
    expect(msg).toContain('filename: YouTube: Soft Proofing in Photoshop');
    expect(msg).toContain('peek_text (first ~500 chars):');
    expect(msg).toContain(video.text.slice(0, 500));
    expect(msg).not.toContain(video.text.slice(0, 501));
    expect(updateMaterialTier).toHaveBeenCalledWith('m1', 'middle');
  });

  it('leaves the tier unset (read in full) when the classifier fails', async () => {
    vi.mocked(getProviderForFunction).mockResolvedValueOnce({ complete: vi.fn(async () => { throw new Error('campus 503'); }) } as never);
    expect(await tierLinkedMaterial('m2', video, 'GC 3460')).toBeNull();
    expect(updateMaterialTier).not.toHaveBeenCalled();
  });
});

describe('material-classify prompt', () => {
  it('tells the model how to treat linked videos and documents', async () => {
    const p = await loadPrompt('material-classify');
    expect(p).toContain('`YouTube:`');
    expect(p).toMatch(/substantive teaching video[^.]*is `middle`/);
  });
});
