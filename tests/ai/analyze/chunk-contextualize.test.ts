import { describe, it, expect, beforeEach, vi } from 'vitest';
import { contextualizeChunk } from '@/lib/ai/analyze/chunk-contextualize';

vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});

import { getProviderForFunction } from '@/lib/ai/provider';

const makeStub = (blurb: string) => ({
  name: 'fake' as const,
  model: 'test-model',
  complete: vi.fn(async (args: { validate: (raw: unknown) => unknown }) => ({
    data: args.validate({ blurb }),
    costUsdCents: 0,
    durationMs: 1,
    cachedTokens: 0,
    uncachedPromptTokens: 50,
    completionTokens: 20,
  })),
  completeWithTools: vi.fn(),
  transcribeDocument: vi.fn(),
});

describe('contextualizeChunk', () => {
  beforeEach(() => {
    vi.mocked(getProviderForFunction).mockReset();
    // Force the OpenAI fallback path so the mocked provider is exercised
    // regardless of whether campus env vars are present (.env.local).
    process.env.CHUNK_LLM_SKIP_CAMPUS = '1';
  });

  it('returns the blurb and model', async () => {
    const stub = makeStub('From Chapter 4 of the textbook; covers ΔE perceptibility.');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    const result = await contextualizeChunk({
      materialDigest: '## What this is\nChapter 4 of a color-management textbook.',
      sectionTitle: 'ΔE perceptibility',
      chunkText: 'A ΔE value of 1 is the threshold of human perception.',
    });

    expect(result.blurb).toMatch(/Chapter 4/);
    expect(result.model).toBe('test-model');
  });

  it('passes digest, section title, and chunk text in the user message', async () => {
    const stub = makeStub('A blurb.');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    await contextualizeChunk({
      materialDigest: 'DIGEST_MARKER',
      sectionTitle: 'SECTION_MARKER',
      chunkText: 'CHUNK_MARKER',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (stub.complete.mock.calls as any)[0][0];
    expect(arg.userMessage).toContain('DIGEST_MARKER');
    expect(arg.userMessage).toContain('SECTION_MARKER');
    expect(arg.userMessage).toContain('CHUNK_MARKER');
  });

  it('handles a section with no title gracefully', async () => {
    const stub = makeStub('A blurb.');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    await contextualizeChunk({
      materialDigest: 'd',
      sectionTitle: '',
      chunkText: 'c',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (stub.complete.mock.calls as any)[0][0];
    // No-heading materials get labeled in the user message rather than left blank.
    expect(arg.userMessage).toMatch(/no heading|\(none\)/i);
  });

  it('throws on empty blurb', async () => {
    const stub = makeStub('');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    await expect(
      contextualizeChunk({ materialDigest: 'd', sectionTitle: 's', chunkText: 'c' }),
    ).rejects.toThrow(/empty/i);
  });
});
