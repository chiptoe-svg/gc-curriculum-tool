import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: async () => ({
    model: 'fake-model',
    complete: async ({ validate }: { validate: (raw: unknown) => unknown }) => ({
      data: validate({ proposals: [{ index: 0, action: 'modify', revised: { statement: null, k: null, u: null, d: 2 }, rationale: 'faculty lowered Do' }] }),
      costUsdCents: 1,
    }),
  }),
}));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: async () => 'SYS' }));

import { reconcileFeedback } from '@/lib/ai/analyze/reconcile-feedback';

describe('reconcileFeedback', () => {
  it('returns validated proposals + flat cost/model telemetry', async () => {
    const out = await reconcileFeedback({ section: 'outgoing', items: [{ statement: 'Color mgmt', k: 3, u: 3, d: 4 }], feedback: 'students cannot do this independently' });
    expect(out.proposals[0]!.action).toBe('modify');
    expect(out.costUsdCents).toBe(1);
    expect(out.model).toBe('fake-model');
  });
});
