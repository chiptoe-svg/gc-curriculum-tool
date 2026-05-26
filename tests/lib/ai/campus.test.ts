import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => {
  function MockOpenAI(_opts: unknown) {
    return { chat: { completions: { create: mockCreate } } };
  }
  return { default: MockOpenAI };
});

import { CampusProvider } from '@/lib/ai/campus';
import { kudOutcomesSchema, kudOutcomesJsonSchema } from '@/lib/ai/schemas';

const validKud = { description: 'A course', know: ['a'], understand: ['b'], do: ['c'] };

const makeResponse = (content: string, promptTokens = 100, completionTokens = 50) => ({
  choices: [{ message: { content } }],
  usage: { prompt_tokens: promptTokens, completion_tokens: completionTokens },
});

beforeEach(() => {
  mockCreate.mockReset();
});

describe('CampusProvider', () => {
  it('reports name and model', () => {
    const p = new CampusProvider('glm-5.1-fp8', 'https://llm.rcd.clemson.edu/v1', 'test-key');
    expect(p.name).toBe('campus');
    expect(p.model).toBe('glm-5.1-fp8');
  });

  it('returns parsed data and zero cost telemetry', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse(JSON.stringify(validKud)));
    const p = new CampusProvider('glm-5.1-fp8', 'https://llm.rcd.clemson.edu/v1', 'test-key');
    const result = await p.complete({
      systemPrompt: 'You are a helpful assistant.',
      userMessage: 'Generate KUDs.',
      schemaName: 'kud_outcomes',
      jsonSchema: kudOutcomesJsonSchema,
      validate: kudOutcomesSchema.parse,
    });
    expect(result.data).toEqual(validKud);
    expect(result.costUsdCents).toBe(0);
    expect(result.cachedTokens).toBe(0);
    expect(result.uncachedPromptTokens).toBe(100);
    expect(result.completionTokens).toBe(50);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('appends schema to system prompt and uses json_object response format', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse(JSON.stringify(validKud)));
    const p = new CampusProvider('glm-5.1-fp8', 'https://llm.rcd.clemson.edu/v1', 'test-key');
    await p.complete({
      systemPrompt: 'Base prompt.',
      userMessage: 'Go.',
      schemaName: 'kud_outcomes',
      jsonSchema: kudOutcomesJsonSchema,
      validate: kudOutcomesSchema.parse,
    });
    const call = mockCreate.mock.calls[0]?.[0];
    const system = call?.messages?.[0]?.content as string;
    expect(system).toContain('Base prompt.');
    expect(system).toContain('valid JSON');
    expect(system).toContain('"description"');
    expect(call?.response_format).toEqual({ type: 'json_object' });
  });

  it('throws on non-JSON response', async () => {
    mockCreate.mockResolvedValueOnce(makeResponse('Sorry, I cannot do that.'));
    const p = new CampusProvider('glm-5.1-fp8', 'https://llm.rcd.clemson.edu/v1', 'test-key');
    await expect(
      p.complete({
        systemPrompt: 'S',
        userMessage: 'U',
        schemaName: 'k',
        jsonSchema: kudOutcomesJsonSchema,
        validate: kudOutcomesSchema.parse,
      }),
    ).rejects.toThrow('Campus model returned non-JSON');
  });

  it('throws from transcribeDocument (handled by caller)', async () => {
    const p = new CampusProvider('glm-5.1-fp8', 'https://llm.rcd.clemson.edu/v1', 'test-key');
    await expect(
      p.transcribeDocument({ fileBytes: Buffer.from('pdf'), mimeType: 'application/pdf' }),
    ).rejects.toThrow('Campus provider does not support document vision transcription');
  });
});

describe('buildProvider with AI_PROVIDER=campus', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('reads CAMPUS_LLM_BASE_URL / CAMPUS_LLM_API_KEY / CAMPUS_LLM_DEFAULT_MODEL', async () => {
    process.env.AI_PROVIDER = 'campus';
    process.env.CAMPUS_LLM_BASE_URL = 'https://llm.example.test/v1';
    process.env.CAMPUS_LLM_API_KEY = 'k';
    process.env.CAMPUS_LLM_DEFAULT_MODEL = 'deepseek-v4-pro';
    const { getProvider } = await import('@/lib/ai/provider');
    const p = getProvider();
    expect(p.name).toBe('campus');
    expect(p.model).toBe('deepseek-v4-pro');
  });

  it('defaults the model to glm-5.1-fp8 when CAMPUS_LLM_DEFAULT_MODEL is unset', async () => {
    process.env.AI_PROVIDER = 'campus';
    process.env.CAMPUS_LLM_BASE_URL = 'https://llm.example.test/v1';
    process.env.CAMPUS_LLM_API_KEY = 'k';
    delete process.env.CAMPUS_LLM_DEFAULT_MODEL;
    const { getProvider } = await import('@/lib/ai/provider');
    const p = getProvider();
    expect(p.model).toBe('glm-5.1-fp8');
  });

  it('throws when CAMPUS_LLM_BASE_URL is missing', async () => {
    process.env.AI_PROVIDER = 'campus';
    delete process.env.CAMPUS_LLM_BASE_URL;
    process.env.CAMPUS_LLM_API_KEY = 'k';
    const { getProvider } = await import('@/lib/ai/provider');
    expect(() => getProvider()).toThrow(/CAMPUS_LLM_BASE_URL not set/);
  });

  it('throws when CAMPUS_LLM_API_KEY is missing', async () => {
    process.env.AI_PROVIDER = 'campus';
    process.env.CAMPUS_LLM_BASE_URL = 'https://llm.example.test/v1';
    delete process.env.CAMPUS_LLM_API_KEY;
    const { getProvider } = await import('@/lib/ai/provider');
    expect(() => getProvider()).toThrow(/CAMPUS_LLM_API_KEY not set/);
  });
});
