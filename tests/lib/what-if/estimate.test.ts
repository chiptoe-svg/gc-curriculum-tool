import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { NeighborContext } from '@/lib/ai/explore/neighbor-context';
import { baseProfile, foundationalRow } from '../../helpers/capture-profile-fixture';

const complete = vi.fn();
const getProviderForFunction = vi.fn();
vi.mock('@/lib/ai/provider', () => ({ getProviderForFunction: (...a: unknown[]) => getProviderForFunction(...a) }));

import { estimateWhatIf } from '@/lib/what-if/estimate';

const approved = baseProfile([
  { statement: 'Prepare print-ready files.', type: 'technical', k_depth: 3, u_depth: 2, d_depth: 3,
    evidence_k: 'q', evidence_u: 'r', evidence_d: 'g', rationale: 'x' },
  foundationalRow('Attention to detail'),
]) as unknown as CaptureProfile;

const neighborContext: NeighborContext = {
  focal: { courseCode: 'GC 3460', competencies: [], incoming_expectations: [] },
  upstream: [{ courseCode: 'GC 1040', competencies: [{ statement: 'Upstream skill', type: 'technical', k_depth: 1, u_depth: 1, d_depth: 2 }], incoming_expectations: [] }],
  downstream: [],
};

const base = {
  courseCode: 'GC 3460', approved,
  conversation: [
    { role: 'user' as const, content: 'Add a color management lab' },
    { role: 'assistant' as const, content: 'What would students produce?' },
    { role: 'user' as const, content: 'A calibrated proof' },
  ],
  attachments: [{ fileName: 'plan.docx', text: 'Week 5: lab on ICC profiles' }],
  neighborContext,
  catalog: [{ id: 'color-management', name: 'Color management' }],
};

const estimate = { changeItems: [], movedRatings: [], newCompetencies: [], incomingChanges: [] };
const telemetry = { costUsdCents: 3, durationMs: 10, cachedTokens: 0, uncachedPromptTokens: 5, completionTokens: 6 };

beforeEach(() => {
  complete.mockReset();
  getProviderForFunction.mockReset();
  complete.mockImplementation(async (args: { validate: (r: unknown) => unknown }) => ({ data: args.validate(estimate), ...telemetry }));
  getProviderForFunction.mockResolvedValue({ model: 'm', complete });
});

describe('estimateWhatIf', () => {
  it('uses the what-if-estimate function for the course', async () => {
    const out = await estimateWhatIf(base);
    expect(getProviderForFunction).toHaveBeenCalledWith('what-if-estimate', { courseCode: 'GC 3460' });
    expect(out.estimate).toEqual(estimate);
    expect(out.telemetry).toEqual(telemetry);
  });

  it('sends approved ratings, every turn, attachment text under its name, and catalog ids', async () => {
    await estimateWhatIf(base);
    const { userMessage, schemaName } = complete.mock.calls[0]![0] as { userMessage: string; schemaName: string };
    expect(schemaName).toBe('what_if_estimate_v1');
    expect(userMessage).toContain('Prepare print-ready files.');
    expect(userMessage).toContain('K3 U2 D3');
    expect(userMessage).toContain('Attention to detail');
    for (const t of base.conversation) expect(userMessage).toContain(t.content);
    expect(userMessage).toContain('plan.docx');
    expect(userMessage).toContain('Week 5: lab on ICC profiles');
    expect(userMessage).toContain('color-management');
    expect(userMessage).toContain('Upstream skill');
    expect(userMessage).not.toContain('only that candidate');
  });

  it('with a candidate, asks for an estimate of only that candidate', async () => {
    await estimateWhatIf({ ...base, candidate: 'Replace the final exam with a proof portfolio' });
    const { userMessage } = complete.mock.calls[0]![0] as { userMessage: string };
    expect(userMessage).toContain('Replace the final exam with a proof portfolio');
    expect(userMessage).toContain('only that candidate');
  });
});
