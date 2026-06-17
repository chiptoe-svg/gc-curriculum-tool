import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock the campus provider class: each instance records the model it was
// constructed with and a `complete` spy we can program per-test.
const campusComplete = vi.hoisted(() => vi.fn());
const campusCtor = vi.hoisted(() => vi.fn());

vi.mock('@/lib/ai/campus', () => ({
  CampusProvider: class {
    readonly model: string;
    complete = campusComplete;
    constructor(model: string, baseURL: string, apiKey: string, opts?: unknown) {
      this.model = model;
      campusCtor(model, baseURL, apiKey, opts);
    }
  },
}));

vi.mock('@/lib/ai/provider', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/provider')>('@/lib/ai/provider');
  return { ...actual, getProviderForFunction: vi.fn() };
});

import { chunkLlmComplete } from '@/lib/ai/analyze/chunk-llm-provider';
import { getProviderForFunction } from '@/lib/ai/provider';

const telemetry = {
  costUsdCents: 0,
  durationMs: 1,
  cachedTokens: 0,
  uncachedPromptTokens: 10,
  completionTokens: 5,
};

const args = {
  systemPrompt: 'sys',
  userMessage: 'msg',
  schemaName: 'chunk_context',
  jsonSchema: { type: 'object' },
  validate: (raw: unknown) => raw as { blurb: string },
};

const openaiProvider = (model: string) => ({
  name: 'openai' as const,
  model,
  complete: vi.fn(async () => ({ data: { blurb: 'from-openai' }, ...telemetry })),
  completeWithTools: vi.fn(),
  transcribeDocument: vi.fn(),
});

const ORIG = {
  base: process.env.CAMPUS_LLM_BASE_URL,
  key: process.env.CAMPUS_LLM_API_KEY,
  skip: process.env.CHUNK_LLM_SKIP_CAMPUS,
  model: process.env.CHUNK_LLM_CAMPUS_MODEL,
};

beforeEach(() => {
  campusComplete.mockReset();
  campusCtor.mockReset();
  vi.mocked(getProviderForFunction).mockReset();
  process.env.CAMPUS_LLM_BASE_URL = 'https://llm.rcd.clemson.edu/v1';
  process.env.CAMPUS_LLM_API_KEY = 'test-key';
  delete process.env.CHUNK_LLM_SKIP_CAMPUS;
  delete process.env.CHUNK_LLM_CAMPUS_MODEL;
});

afterEach(() => {
  // Restore so leaking env doesn't perturb other suites.
  if (ORIG.base === undefined) delete process.env.CAMPUS_LLM_BASE_URL; else process.env.CAMPUS_LLM_BASE_URL = ORIG.base;
  if (ORIG.key === undefined) delete process.env.CAMPUS_LLM_API_KEY; else process.env.CAMPUS_LLM_API_KEY = ORIG.key;
  if (ORIG.skip === undefined) delete process.env.CHUNK_LLM_SKIP_CAMPUS; else process.env.CHUNK_LLM_SKIP_CAMPUS = ORIG.skip;
  if (ORIG.model === undefined) delete process.env.CHUNK_LLM_CAMPUS_MODEL; else process.env.CHUNK_LLM_CAMPUS_MODEL = ORIG.model;
});

describe('chunkLlmComplete', () => {
  it('uses campus gpt-oss-120b on success and returns its model', async () => {
    campusComplete.mockResolvedValueOnce({ data: { blurb: 'from-campus' }, ...telemetry });

    const result = await chunkLlmComplete<{ blurb: string }>('chunk-contextualize', args);

    expect(campusComplete).toHaveBeenCalledTimes(1);
    expect(getProviderForFunction).not.toHaveBeenCalled();
    expect(result.data.blurb).toBe('from-campus');
    expect(result.model).toBe('gptoss-120b');
    // reasoning_effort:'low' is passed at construction so content stays JSON.
    expect(campusCtor).toHaveBeenCalledWith(
      'gptoss-120b',
      'https://llm.rcd.clemson.edu/v1',
      'test-key',
      { reasoningEffort: 'low' },
    );
  });

  it('honors CHUNK_LLM_CAMPUS_MODEL override', async () => {
    process.env.CHUNK_LLM_CAMPUS_MODEL = 'gptoss-20b';
    campusComplete.mockResolvedValueOnce({ data: { blurb: 'x' }, ...telemetry });

    const result = await chunkLlmComplete<{ blurb: string }>('chunk-contextualize', args);

    expect(result.model).toBe('gptoss-20b');
    expect(campusCtor).toHaveBeenCalledWith('gptoss-20b', expect.anything(), expect.anything(), expect.anything());
  });

  it('falls back to OpenAI when campus throws', async () => {
    campusComplete.mockRejectedValueOnce(new Error('campus unreachable'));
    const openai = openaiProvider('gpt-5.4-mini');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(openai as never);

    const result = await chunkLlmComplete<{ blurb: string }>('chunk-contextualize', args);

    expect(campusComplete).toHaveBeenCalledTimes(1);
    expect(getProviderForFunction).toHaveBeenCalledWith('chunk-contextualize');
    expect(openai.complete).toHaveBeenCalledTimes(1);
    expect(result.data.blurb).toBe('from-openai');
    expect(result.model).toBe('gpt-5.4-mini');
  });

  it('skips campus entirely when CHUNK_LLM_SKIP_CAMPUS=1', async () => {
    process.env.CHUNK_LLM_SKIP_CAMPUS = '1';
    const openai = openaiProvider('gpt-5.4-mini');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(openai as never);

    const result = await chunkLlmComplete<{ blurb: string }>('material-digest', args);

    expect(campusCtor).not.toHaveBeenCalled();
    expect(campusComplete).not.toHaveBeenCalled();
    expect(getProviderForFunction).toHaveBeenCalledWith('material-digest');
    expect(result.model).toBe('gpt-5.4-mini');
  });

  it('skips campus when env vars are absent', async () => {
    delete process.env.CAMPUS_LLM_BASE_URL;
    delete process.env.CAMPUS_LLM_API_KEY;
    const openai = openaiProvider('gpt-5.4-mini');
    vi.mocked(getProviderForFunction).mockResolvedValueOnce(openai as never);

    await chunkLlmComplete<{ blurb: string }>('chunk-contextualize', args);

    expect(campusCtor).not.toHaveBeenCalled();
    expect(getProviderForFunction).toHaveBeenCalledTimes(1);
  });
});
