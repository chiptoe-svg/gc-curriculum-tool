import { describe, it, expect, beforeEach, vi } from 'vitest';

// The OpenAI SDK constructor throws in jsdom (browser-like) test environments.
// Mock it so LocalProvider can be constructed without network access.
vi.mock('openai', () => ({
  default: class MockOpenAI {
    constructor(_opts: unknown) {}
  },
}));

import { buildLocalProvider } from '../provider';

describe('buildLocalProvider', () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = 'openai'; // prod-like: global is OpenAI
    process.env.LOCAL_BASE_URL = 'http://localhost:8000/v1';
    process.env.LOCAL_API_KEY = 'godfrey';
    delete process.env.LOCAL_VISION_MODEL;
  });

  it('returns a LocalProvider regardless of AI_PROVIDER', () => {
    const p = buildLocalProvider();
    expect(p.name).toBe('local');
    expect(p.model).toBe('Qwen3.6-35B-A3B-UD-MLX-4bit'); // LOCAL_VISION_MODEL default
  });

  it('honors LOCAL_VISION_MODEL and an explicit override', () => {
    process.env.LOCAL_VISION_MODEL = 'some-vlm';
    expect(buildLocalProvider().model).toBe('some-vlm');
    expect(buildLocalProvider('override-vlm').model).toBe('override-vlm');
  });
});
