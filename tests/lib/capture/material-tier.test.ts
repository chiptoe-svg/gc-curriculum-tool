import { describe, it, expect, vi, beforeEach } from 'vitest';
import { classifyByKind } from '@/lib/capture/material-tier';

describe('classifyByKind', () => {
  it('graded/assessed → high', () => {
    for (const k of ['syllabus', 'assignments', 'quizzes'] as const)
      expect(classifyByKind(k)).toBe('high');
  });
  it('instructional → middle', () => {
    for (const k of ['pages', 'discussions', 'modules'] as const)
      expect(classifyByKind(k)).toBe('middle');
  });
  it('file → null (needs signals)', () => {
    expect(classifyByKind('file')).toBeNull();
  });
});

vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});

import { classifyFile, classifyManifestItem } from '@/lib/capture/material-tier';
import { getProviderForFunction } from '@/lib/ai/provider';

const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

const stub = (tier: string) => ({
  name: 'fake',
  model: 'm',
  complete: vi.fn(async (a: { validate: (r: unknown) => unknown }) => ({
    data: a.validate({ tier }),
    costUsdCents: 0,
    durationMs: 1,
    cachedTokens: 0,
    uncachedPromptTokens: 1,
    completionTokens: 1,
  })),
  completeWithTools: vi.fn(),
  transcribeDocument: vi.fn(),
});

beforeEach(() => vi.mocked(getProviderForFunction).mockReset());

describe('classifyFile', () => {
  it('PPTX → middle, no LLM', async () => {
    const t = await classifyFile({ fileName: 'wk1.pptx', mimeType: PPTX, sizeBytes: 1000 });
    expect(t).toBe('middle');
    expect(getProviderForFunction).not.toHaveBeenCalled();
  });

  it('PDF deck → middle via LLM', async () => {
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub('middle') as never);
    expect(
      await classifyFile({ fileName: 'lecture3.pdf', mimeType: 'application/pdf', sizeBytes: 9, pageCount: 30 }),
    ).toBe('middle');
  });

  it('LLM error → background (bias cheap)', async () => {
    vi.mocked(getProviderForFunction).mockResolvedValueOnce({
      name: 'f',
      model: 'm',
      complete: vi.fn(async () => {
        throw new Error('down');
      }),
      completeWithTools: vi.fn(),
      transcribeDocument: vi.fn(),
    } as never);
    expect(await classifyFile({ fileName: 'r.pdf', mimeType: 'application/pdf', sizeBytes: 9 })).toBe('background');
  });
});

describe('classifyManifestItem', () => {
  it('structural kind wins over signals (no LLM call)', async () => {
    // A graded item that happens to carry a slideCount must still be 'high' —
    // structure beats file signals, and no classifier runs.
    const t = await classifyManifestItem({ kind: 'assignments', mimeType: PPTX, sizeBytes: 1, slideCount: 5 });
    expect(t).toBe('high');
    expect(getProviderForFunction).not.toHaveBeenCalled();
  });

  it("delegates to the file classifier for kind 'file'", async () => {
    const t = await classifyManifestItem({ kind: 'file', fileName: 'wk1.pptx', mimeType: PPTX, sizeBytes: 1 });
    expect(t).toBe('middle'); // PPTX → deterministic middle, still no LLM
    expect(getProviderForFunction).not.toHaveBeenCalled();
  });
});
