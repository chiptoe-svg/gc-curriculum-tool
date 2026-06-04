import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProviderForFunction, loadPrompt } = vi.hoisted(() => ({
  getProviderForFunction: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProviderForFunction }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { analyzeMaterial } from '@/lib/ai/course-profile/analyze-material';

const fakeFinding = {
  materialType: 'rubric',
  competencies: [
    { name: 'Color management', description: 'Hit delta-E ≤ 2.', evidenceQuotes: ['delta-E of ≤ 2.0'] },
  ],
  skills: ['Spectrophotometry'],
  notes: '',
};

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('ANALYZE SYSTEM PROMPT');
  // getProviderForFunction is async (returns Promise<AIProvider>) — mockResolvedValue.
  getProviderForFunction.mockResolvedValue({
    name: 'openai',
    model: 'gpt-5.4-mini',
    complete: vi.fn().mockResolvedValue({
      data: fakeFinding,
      costUsdCents: 7,
      durationMs: 200,
      cachedTokens: 0,
      uncachedPromptTokens: 300,
      completionTokens: 100,
    }),
  });
});

const courseContext = {
  code: 'GC 4060',
  title: 'Color Science and Management',
  level: 4,
  track: 'print',
  description: 'Advanced color management for press and digital output.',
};

describe('analyzeMaterial', () => {
  it('returns the parsed finding plus telemetry', async () => {
    const out = await analyzeMaterial({
      courseContext,
      fileName: 'rubric-press-check.pdf',
      extractedText: 'Students must hit a delta-E of ≤ 2.0 on the press check.',
    });
    expect(out.data.materialType).toBe('rubric');
    expect(out.data.competencies).toHaveLength(1);
    expect(out.telemetry.costUsdCents).toBe(7);
  });

  it('passes course context, fileName, and extractedText into the user message', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: fakeFinding,
      costUsdCents: 1,
      durationMs: 1,
      cachedTokens: 0,
      uncachedPromptTokens: 0,
      completionTokens: 0,
    });
    getProviderForFunction.mockResolvedValue({ name: 'openai', model: 'gpt', complete: completeMock });

    await analyzeMaterial({
      courseContext,
      fileName: 'project-brief.docx',
      extractedText: 'Design a 4-color trade-show display.',
    });

    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.systemPrompt).toBe('ANALYZE SYSTEM PROMPT');
    expect(arg.userMessage).toContain('GC 4060');
    expect(arg.userMessage).toContain('project-brief.docx');
    expect(arg.userMessage).toContain('Design a 4-color trade-show display.');
  });

  it('uses the analyze-material prompt name', async () => {
    await analyzeMaterial({ courseContext, fileName: 'f.pdf', extractedText: 'text' });
    expect(loadPrompt).toHaveBeenCalledWith('analyze-material');
  });

  it('passes document bytes to provider.complete() when documentBytes is provided', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: fakeFinding,
      costUsdCents: 5,
      durationMs: 10,
      cachedTokens: 0,
      uncachedPromptTokens: 0,
      completionTokens: 0,
    });
    getProviderForFunction.mockResolvedValue({ name: 'anthropic', model: 'claude-sonnet-4-6', complete: completeMock });

    const pdfBytes = Buffer.from('%PDF-1.4 fake pdf content');
    await analyzeMaterial({
      courseContext,
      fileName: 'rubric.pdf',
      extractedText: 'some fallback text',
      documentBytes: pdfBytes,
      documentMimeType: 'application/pdf',
    });

    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.documents).toHaveLength(1);
    expect(arg.documents[0].bytes).toEqual(pdfBytes);
    expect(arg.documents[0].mimeType).toBe('application/pdf');
  });

  it('omits extracted text from user message when documentBytes is provided', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: fakeFinding,
      costUsdCents: 5,
      durationMs: 10,
      cachedTokens: 0,
      uncachedPromptTokens: 0,
      completionTokens: 0,
    });
    getProviderForFunction.mockResolvedValue({ name: 'anthropic', model: 'claude-sonnet-4-6', complete: completeMock });

    await analyzeMaterial({
      courseContext,
      fileName: 'rubric.pdf',
      extractedText: 'DO NOT INCLUDE THIS TEXT',
      documentBytes: Buffer.from('%PDF'),
      documentMimeType: 'application/pdf',
    });

    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.userMessage).not.toContain('DO NOT INCLUDE THIS TEXT');
    expect(arg.userMessage).toContain('GC 4060');
    expect(arg.userMessage).toContain('rubric.pdf');
  });
});
