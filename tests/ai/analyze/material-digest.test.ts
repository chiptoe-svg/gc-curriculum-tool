import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateMaterialDigest } from '@/lib/ai/analyze/material-digest';

vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return {
    ...actual,
    getProviderForFunction: vi.fn(),
  };
});

import { getProviderForFunction } from '@/lib/ai/provider';

const makeStub = (digest: string) => ({
  name: 'fake' as const,
  model: 'test-model',
  complete: vi.fn(async (args: { validate: (raw: unknown) => unknown }) => ({
    data: args.validate({ digest }),
    costUsdCents: 0,
    durationMs: 1,
    cachedTokens: 0,
    uncachedPromptTokens: 100,
    completionTokens: 50,
  })),
  completeWithTools: vi.fn(),
  transcribeDocument: vi.fn(),
});

describe('generateMaterialDigest', () => {
  beforeEach(() => {
    vi.mocked(getProviderForFunction).mockReset();
  });

  it('returns the digest body and the model used', async () => {
    const stub = makeStub('## What this material is\n\nA textbook chapter on color reproduction.');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    const result = await generateMaterialDigest({
      fileName: 'Canvas File: Ch4.pdf',
      extractedText: 'Chapter 4. Color reproduction...',
    });

    expect(result.digest).toContain('What this material is');
    expect(result.model).toBe('test-model');
  });

  it('sends fileName and extracted text to the provider in the user message', async () => {
    const stub = makeStub('## What this material is\n\nA short doc.');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    await generateMaterialDigest({
      fileName: 'Canvas File: textbook-ch4.pdf',
      extractedText: 'The ΔE threshold is approximately 1.0 under controlled viewing.',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (stub.complete.mock.calls as any)[0][0];
    expect(arg.userMessage).toContain('Canvas File: textbook-ch4.pdf');
    expect(arg.userMessage).toContain('ΔE threshold');
  });

  it('loads the material-digest system prompt', async () => {
    const stub = makeStub('## What this material is\n\nA digest.');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    await generateMaterialDigest({
      fileName: 'x.md',
      extractedText: 'short',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (stub.complete.mock.calls as any)[0][0];
    expect(arg.systemPrompt).toMatch(/digest/i);
  });

  it('throws when the model returns an empty digest string', async () => {
    const stub = makeStub('');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    await expect(
      generateMaterialDigest({ fileName: 'x.md', extractedText: 'short' }),
    ).rejects.toThrow(/empty/i);
  });
});
