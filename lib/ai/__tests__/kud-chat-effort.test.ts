// @vitest-environment node
/** KUD chat follows the same effort order as every other call: env knob above the role's effort. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { create } = vi.hoisted(() => ({
  create: vi.fn(async (_body: Record<string, unknown>) => ({ choices: [{ message: { content: 'ok' } }] })),
}));
vi.mock('openai', () => ({ default: class { chat = { completions: { create } }; constructor(_o: unknown) {} } }));
vi.mock('@/lib/ai/function-settings', () => ({
  resolveForFunction: vi.fn(async () => ({ model: 'gpt-6.1-sol', effort: 'low' })),
}));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn(async () => 'system') }));

import { kudChatTurn } from '@/lib/ai/analyze/kud-chat';

const PROFILE = { title: 't', description: 'd', learningObjectives: [], majorProjects: [], skillsRequired: [] };

describe('kudChatTurn effort', () => {
  beforeEach(() => { process.env.OPENAI_API_KEY = 'x'; create.mockClear(); delete process.env.OPENAI_REASONING_EFFORT; });
  afterEach(() => { delete process.env.OPENAI_REASONING_EFFORT; });

  it('sends the role effort', async () => {
    await kudChatTurn(PROFILE, []);
    expect(create.mock.calls[0]![0].reasoning_effort).toBe('low');
  });

  it('keeps OPENAI_REASONING_EFFORT above the role effort', async () => {
    process.env.OPENAI_REASONING_EFFORT = 'high';
    await kudChatTurn(PROFILE, []);
    expect(create.mock.calls[0]![0].reasoning_effort).toBe('high');
  });
});
