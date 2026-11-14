import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import type { KnockOn, WhatIfEstimate } from '@/lib/what-if/types';
import { baseProfile, foundationalRow } from '../../helpers/capture-profile-fixture';

const estimateWhatIf = vi.fn();
vi.mock('@/lib/what-if/estimate', () => ({ estimateWhatIf: (...a: unknown[]) => estimateWhatIf(...a) }));
const loadWhatIfNeighborContext = vi.fn();
vi.mock('@/lib/what-if/neighbors', () => ({ loadWhatIfNeighborContext: (...a: unknown[]) => loadWhatIfNeighborContext(...a) }));
const computeKnockOn = vi.fn();
vi.mock('@/lib/what-if/knock-on', () => ({ computeKnockOn: (...a: unknown[]) => computeKnockOn(...a) }));
vi.mock('@/lib/db/what-if-queries', () => ({
  listActiveSubCompetencies: async () => [{ id: 'color-management', name: 'Color management' }],
}));

import { buildWhatIfTools } from '@/lib/what-if/agent-tools';

const approved = baseProfile([
  { statement: 'Prepare print-ready files.', type: 'technical', k_depth: 3, u_depth: 2, d_depth: 3,
    evidence_k: 'q', evidence_u: 'r', evidence_d: 'g', rationale: 'x' },
  foundationalRow('Attention to detail'),
]) as unknown as CaptureProfile;

const whatIf = { id: 'w1', courseCode: 'GC 3460', baseSnapshotId: 'snap-1' } as never;
const telemetry = { costUsdCents: 3, durationMs: 10, cachedTokens: 0, uncachedPromptTokens: 5, completionTokens: 6 };
const estimate: WhatIfEstimate = {
  changeItems: [{ kind: 'added', description: 'A calibrated proof lab.' }],
  movedRatings: [{ statement: 'Prepare print-ready files.', after: { k: 3, u: 3, d: 4 }, confidence: 'medium', reason: 'Students proof.' }],
  newCompetencies: [{ statement: 'Manage color', type: 'technical', predicted: { k: 2, u: 1, d: 2 },
    subCompetencyId: 'color-management', confidence: 'low', reason: 'New lab.' }],
  incomingChanges: [],
};
const knockOn: KnockOn = {
  laterCourses: [{ courseCode: 'GC 4060', subCompetencyId: 'color-management', label: 'Color management', effect: 'closed' }],
  earlierCourses: [], careerTargets: [], notComputed: [],
};

beforeEach(() => {
  [estimateWhatIf, loadWhatIfNeighborContext, computeKnockOn].forEach(m => m.mockReset());
  estimateWhatIf.mockResolvedValue({ estimate, telemetry });
  loadWhatIfNeighborContext.mockResolvedValue({ focal: {}, upstream: [], downstream: [] });
  computeKnockOn.mockResolvedValue(knockOn);
});

const quick = (ctx: Record<string, unknown> = {}) => {
  const onEstimate = vi.fn().mockResolvedValue(undefined);
  const tools = buildWhatIfTools({ whatIf, approved, onEstimate, ...ctx } as never);
  return { tool: tools.find(t => t.name === 'quick_estimate')!, onEstimate, tools };
};

describe('quick_estimate', () => {
  it('is the only tool', () => {
    expect(quick().tools.map(t => t.name)).toEqual(['quick_estimate']);
  });

  it('runs the estimate on the candidate, builds the profile and effects, and reports once', async () => {
    const { tool, onEstimate } = quick({
      conversation: [{ role: 'user', content: 'Add a lab' }],
      attachments: [{ fileName: 'a.docx', text: 'plan' }],
    });
    await tool.execute({ candidate: 'Add a proofing lab' });

    expect(estimateWhatIf).toHaveBeenCalledTimes(1);
    expect(estimateWhatIf.mock.calls[0]![0]).toMatchObject({
      courseCode: 'GC 3460', approved, candidate: 'Add a proofing lab',
      conversation: [{ role: 'user', content: 'Add a lab' }],
      attachments: [{ fileName: 'a.docx', text: 'plan' }],
      catalog: [{ id: 'color-management', name: 'Color management' }],
    });
    expect(loadWhatIfNeighborContext).toHaveBeenCalledWith('GC 3460', 'snap-1');
    expect(computeKnockOn).toHaveBeenCalledTimes(1);
    expect(computeKnockOn.mock.calls[0]![0]).toEqual({ courseCode: 'GC 3460', baseSnapshotId: 'snap-1' });

    expect(onEstimate).toHaveBeenCalledTimes(1);
    const [q, t] = onEstimate.mock.calls[0]!;
    expect(q.candidate).toBe('Add a proofing lab');
    expect(q.estimate).toEqual(estimate);
    expect(q.knockOn).toEqual(knockOn);
    expect(q.profile.ratings.map((r: { status: string }) => r.status)).toEqual(['moved', 'approved', 'new']);
    expect(t).toEqual(telemetry);
  });

  it('returns to the model only the moved and new ratings and the effect lines', async () => {
    const { tool } = quick();
    const text = JSON.stringify(await tool.execute({ candidate: 'x' }));
    expect(text).toContain('Prepare print-ready files.');
    expect(text).toContain('Manage color');
    expect(text).toContain('GC 4060');
    expect(text).not.toContain('Attention to detail'); // untouched approved rating
  });

  it('with the base version gone, says so and runs nothing', async () => {
    const { tool, onEstimate } = quick({ whatIf: { id: 'w1', courseCode: 'GC 3460', baseSnapshotId: null }, approved: null });
    const result = await tool.execute({ candidate: 'x' });
    expect(JSON.stringify(result)).toMatch(/no longer exists/);
    expect(estimateWhatIf).not.toHaveBeenCalled();
    expect(computeKnockOn).not.toHaveBeenCalled();
    expect(onEstimate).not.toHaveBeenCalled();
  });
});
