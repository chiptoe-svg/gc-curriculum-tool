// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { OpenAIProvider, OPENAI_TIMEOUT_MS, OPENAI_MAX_RETRIES } from '@/lib/ai/openai';

// A hung gateway call must fail in minutes, not the SDK default of
// 10 min x 3 attempts (2026-10-05: evaluation passes stalled ~14 min).
describe('OpenAIProvider client limits', () => {
  it('bounds each call with an explicit timeout and a single retry', () => {
    const p = new OpenAIProvider('gpt-5.4', 'test-key');
    const client = (p as unknown as { client: { timeout: number; maxRetries: number } }).client;
    expect(client.timeout).toBe(OPENAI_TIMEOUT_MS);
    expect(client.maxRetries).toBe(OPENAI_MAX_RETRIES);
    expect(OPENAI_TIMEOUT_MS * (OPENAI_MAX_RETRIES + 1)).toBeLessThanOrEqual(10 * 60_000);
  });
});
