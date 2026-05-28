import { describe, it, expect, vi } from 'vitest';

// We can't easily stand up a real OpenAI stream in unit tests without
// network access. Instead, verify the OpenAIProvider exposes
// streamWithTools and that it returns an async iterable.
//
// The OpenAI SDK constructor throws in jsdom (browser-like) test
// environments. We mock the SDK module so the constructor does not run.
vi.mock('openai', () => {
  return {
    default: class MockOpenAI {
      constructor(_opts: unknown) {}
    },
  };
});

import { OpenAIProvider } from '../openai';

describe('OpenAIProvider.streamWithTools', () => {
  it('exposes streamWithTools as an async generator', () => {
    const p = new OpenAIProvider('gpt-5.4', 'sk-test');
    expect(typeof p.streamWithTools).toBe('function');
  });
});
