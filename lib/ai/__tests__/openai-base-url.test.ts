import { describe, it, expect, afterEach, vi } from 'vitest';
import { openAIBaseURL } from '../openai-base-url';

describe('openAIBaseURL', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('returns undefined when unset (→ SDK default api.openai.com)', () => {
    vi.stubEnv('OPENAI_BASE_URL', '');
    expect(openAIBaseURL()).toBeUndefined();
  });

  it('returns the trimmed proxy URL when set', () => {
    vi.stubEnv('OPENAI_BASE_URL', '  https://llm.rcd.clemson.edu/openai/v1  ');
    expect(openAIBaseURL()).toBe('https://llm.rcd.clemson.edu/openai/v1');
  });
});
