import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateIngestionCheckIn } from '@/lib/ai/analyze/ingestion-checkin';

vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});

import { getProviderForFunction } from '@/lib/ai/provider';

const makeStub = (out: { message: string | null; highlights: Array<{ kind: string; text: string }> }) => ({
  name: 'fake' as const,
  model: 'test-model',
  complete: vi.fn(async (args: { validate: (raw: unknown) => unknown }) => ({
    data: args.validate(out),
    costUsdCents: 0,
    durationMs: 1,
    cachedTokens: 0,
    uncachedPromptTokens: 100,
    completionTokens: 30,
  })),
  completeWithTools: vi.fn(),
  transcribeDocument: vi.fn(),
});

const sampleInput = {
  catalog: {
    code: 'GC 4800',
    title: 'Capstone',
    learningObjectives: ['Design a brand system'],
    majorProjects: ['Brand book'],
  },
  materials: [
    {
      fileName: 'Canvas: Syllabus',
      ferpaRisk: 'low' as const,
      autoSetAside: false,
      setAsideReason: null,
      digestSnippet: 'A syllabus covering all capstone expectations.',
    },
  ],
  context: {
    catalogCoversSyllabus: true,
    hasCanvasAssignments: false,
    canvasSyllabusSetAside: false,
  },
};

describe('generateIngestionCheckIn', () => {
  beforeEach(() => vi.mocked(getProviderForFunction).mockReset());

  it('returns { message: null, highlights: [], model } when stub returns null message', async () => {
    const stub = makeStub({ message: null, highlights: [] });
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    const result = await generateIngestionCheckIn(sampleInput);

    expect(result.message).toBeNull();
    expect(result.highlights).toEqual([]);
    expect(result.model).toBe('test-model');
  });

  it('returns the model structured output when highlights are populated', async () => {
    const stub = makeStub({
      message: 'One material has a high FERPA risk but was not set aside.',
      highlights: [
        { kind: 'ferpa', text: 'gradebook-export.xlsx — high FERPA risk, not set aside' },
      ],
    });
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    const result = await generateIngestionCheckIn(sampleInput);

    expect(result.message).toContain('FERPA');
    expect(result.highlights).toHaveLength(1);
    const first = result.highlights[0];
    expect(first?.kind).toBe('ferpa');
    expect(result.model).toBe('test-model');
  });

  it('includes the catalog JSON in the user message', async () => {
    const stub = makeStub({ message: null, highlights: [] });
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    await generateIngestionCheckIn(sampleInput);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (stub.complete.mock.calls as any)[0][0];
    expect(arg.userMessage).toContain('GC 4800');
    expect(arg.userMessage).toContain('Capstone');
  });

  it('includes the materials JSON in the user message', async () => {
    const stub = makeStub({ message: null, highlights: [] });
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    await generateIngestionCheckIn(sampleInput);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (stub.complete.mock.calls as any)[0][0];
    expect(arg.userMessage).toContain('Canvas: Syllabus');
  });

  it('loads the ingestion-checkin system prompt', async () => {
    const stub = makeStub({ message: null, highlights: [] });
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(stub as never);

    await generateIngestionCheckIn(sampleInput);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arg = (stub.complete.mock.calls as any)[0][0];
    // The prompt mentions "audit" prominently — a distinctive word from the ingestion-checkin prompt
    expect(arg.systemPrompt).toMatch(/audit|check-in|materials/i);
  });
});
