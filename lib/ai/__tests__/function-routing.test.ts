// @vitest-environment node
/** Part 2 Task 2: Extract functions the benchmark cleared run on campus Qwen3.8 (thinking off), with an OpenAI fallback. */
import { describe, it, expect, vi } from 'vitest';

vi.mock('openai', () => ({ default: class MockOpenAI { constructor(_opts: unknown) {} } }));
vi.mock('@/lib/db/client', () => ({ db: {} }));

import { resolveSetting } from '@/lib/ai/function-settings';
import { FallbackProvider, type AIProvider } from '@/lib/ai/provider';

const fake = (name: 'campus' | 'openai', impl: () => Promise<unknown>): AIProvider => ({
  name, model: name === 'campus' ? 'qwen3.8-27b-fp8' : 'gpt-5.4-mini',
  complete: impl as never, completeWithTools: impl as never, transcribeDocument: impl as never,
  streamWithTools: async function* () { yield (await impl()) as never; } as never,
});

describe('per-function routing', () => {
  it('the three Extract functions resolve to campus qwen3.8 off', () => {
    for (const id of ['parse-profile-fields', 'materials-analysis', 'decompose-prereq-gap'] as const) {
      const r = resolveSetting(id, null, null);
      expect({ id, provider: r.provider, model: r.model, effort: r.effort }).toEqual({ id, provider: 'campus', model: 'qwen3.8-27b-fp8', effort: 'off' });
      expect(r.fallback?.model).toBe('gpt-5.4-mini');
    }
  });

  it('material-classify, ingestion-checkin and jd-extract stay on OpenAI', () => {
    for (const id of ['material-classify', 'ingestion-checkin', 'jd-extract'] as const) {
      expect(resolveSetting(id, null, null).provider).toBe('openai');
    }
  });

  it('a DB override still wins over the code default', () => {
    const r = resolveSetting('parse-profile-fields', 'extract', null);
    expect(r.provider).toBe('openai');
    expect(r.model).toBe('gpt-5.4-mini');
  });

  it('campus failure on a routed Extract function falls back to OpenAI when the course has no switch', async () => {
    const p = new FallbackProvider(
      fake('campus', async () => { throw new Error('campus 503'); }),
      fake('openai', async () => ({ data: 'from openai' })),
    );
    await expect(p.complete({} as never)).resolves.toEqual({ data: 'from openai' });
  });

  it('a stream falls back only before its first event', async () => {
    const primary = fake('campus', async () => ({ type: 'text-delta', delta: 'x' }));
    primary.streamWithTools = (async function* () { yield { type: 'text-delta', delta: 'x' }; throw new Error('mid-stream'); }) as never;
    const p = new FallbackProvider(primary, fake('openai', async () => ({ type: 'final' })));
    const seen: unknown[] = [];
    await expect((async () => { for await (const e of p.streamWithTools({} as never)) seen.push(e); })()).rejects.toThrow('mid-stream');
    expect(seen).toHaveLength(1);
  });
});

describe('FallbackProvider reports the model that served the call', () => {
  it('names the fallback model after a fallback', async () => {
    const p = new FallbackProvider(
      fake('campus', async () => { throw new Error('campus 503'); }),
      fake('openai', async () => ({ data: 'x' })),
    );
    expect(p.model).toBe('qwen3.8-27b-fp8');
    await p.complete({} as never);
    expect(p.model).toBe('gpt-5.4-mini');
    expect(p.name).toBe('openai');
  });
});
