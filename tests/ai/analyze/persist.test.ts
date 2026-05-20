import { describe, it, expect, vi, beforeEach } from 'vitest';

const { insertRun, recordSpend } = vi.hoisted(() => ({ insertRun: vi.fn(), recordSpend: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ insertRun }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ recordSpend }));

import { persistAnalyzeRun } from '@/lib/ai/analyze/persist';

beforeEach(() => {
  vi.clearAllMocks();
});

const baseInput = {
  ipHash: 'hash',
  careerTargetId: 'target',
  courseLabel: 'GC 4060',
  courseSyllabus: 'syllabus body',
  priorCoursework: [],
  result: { careerTargetId: 'target', courses: [], scaffolding: [], meta: { aiProvider: 'openai', aiModel: 'gpt', durationMs: 1, costUsdCents: 1, cachedTokens: 0, uncachedTokens: 0, completionTokens: 0 } },
  aiProvider: 'openai',
  aiModel: 'gpt',
  costUsdCents: 5,
  durationMs: 100,
  analysisKind: 'target_chain' as const,
};

describe('persistAnalyzeRun', () => {
  it('inserts a run and records spend, returning the runId', async () => {
    insertRun.mockResolvedValue({ id: 'run-1' });
    recordSpend.mockResolvedValue(undefined);
    const runId = await persistAnalyzeRun(baseInput);
    expect(runId).toBe('run-1');
    expect(insertRun).toHaveBeenCalled();
    expect(recordSpend).toHaveBeenCalledWith(5);
  });
  it('returns null on insert failure rather than throwing', async () => {
    insertRun.mockRejectedValue(new Error('db down'));
    const runId = await persistAnalyzeRun(baseInput);
    expect(runId).toBeNull();
    expect(recordSpend).not.toHaveBeenCalled();
  });
});
