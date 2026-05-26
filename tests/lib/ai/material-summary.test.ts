import { describe, it, expect, vi, beforeEach } from 'vitest';

const createMock = vi.fn();
vi.mock('openai', () => {
  function MockOpenAI(_opts: unknown) {
    return { chat: { completions: { create: createMock } } };
  }
  return { default: MockOpenAI };
});
vi.mock('@/lib/ai/function-settings', () => ({
  resolveModelForFunction: vi.fn().mockResolvedValue('gpt-5.4-mini'),
}));
vi.mock('@/lib/ai/prompts/load', () => ({
  loadPrompt: vi.fn().mockResolvedValue('SYSTEM PROMPT BODY'),
}));

import { summarizeMaterial } from '@/lib/ai/analyze/material-summary';

describe('summarizeMaterial', () => {
  beforeEach(() => {
    createMock.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  it('returns the model reply and the resolved model name', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: 'Material kind: textbook chapter\n...' } }],
    });
    const result = await summarizeMaterial({
      fileName: 'Drive PDF: chapter-3.pdf',
      extractedText: 'long text here',
    });
    expect(result.summary).toContain('Material kind: textbook chapter');
    expect(result.model).toBe('gpt-5.4-mini');
    expect(createMock).toHaveBeenCalledOnce();
    const args = createMock.mock.calls[0]![0];
    expect(args.model).toBe('gpt-5.4-mini');
    expect(args.messages[0].role).toBe('system');
    expect(args.messages[0].content).toBe('SYSTEM PROMPT BODY');
    expect(args.messages[1].role).toBe('user');
    expect(args.messages[1].content).toContain('Drive PDF: chapter-3.pdf');
    expect(args.messages[1].content).toContain('long text here');
  });

  it('throws when OPENAI_API_KEY is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(
      summarizeMaterial({ fileName: 'foo', extractedText: 'bar' }),
    ).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it('throws when the model returns empty content', async () => {
    createMock.mockResolvedValue({ choices: [{ message: { content: '' } }] });
    await expect(
      summarizeMaterial({ fileName: 'foo', extractedText: 'bar' }),
    ).rejects.toThrow(/No content/);
  });
});
