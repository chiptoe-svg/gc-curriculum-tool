import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CaptureProfile } from '@/lib/ai/capture/schema';
import { ASSIGNMENTS_TEXT, SYLLABUS_TEXT } from './fixtures';

const { complete, recordSpend } = vi.hoisted(() => ({ complete: vi.fn(), recordSpend: vi.fn() }));
vi.mock('@/lib/ai/provider', () => ({
  getProviderForFunction: vi.fn(async () => ({ name: 'fake', model: 'gpt-test', complete })),
}));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt: vi.fn(async () => 'SYSTEM PROMPT') }));
vi.mock('@/lib/rate-limit/daily-cap', () => ({ recordSpend }));

import { generateObjectiveGuide, buildGuideUserMessage } from '../generate';
import { parseCanvasAssignmentNames } from '../canvas-names';
import { getProviderForFunction } from '@/lib/ai/provider';

const PROFILE = {
  competencies: [
    { statement: 'Builds audience-grounded brand strategy', type: 'technical', k_depth: 3, u_depth: 2, d_depth: 3,
      evidence_k: null, evidence_u: 'Explains why the audience matters', evidence_d: 'Brand Audit research section',
      rationale: 'r', citations: [{ type: 'chunk', chunkId: 'c1', excerpt: 'cite three sources' }] },
  ],
  course_emphasis: [{ competency: 'Builds audience-grounded brand strategy', points: 50, share_pct: 100, centrality: 'central' }],
  audit_notes: { objective_misalignments: ['Objective 3 has no assessment.'] },
  verification_summary: { catalog_vs_evidence: ['Catalog overstates presentation work.'] },
} as unknown as CaptureProfile;

const INPUT = {
  courseCode: 'MKT 4320',
  courseTitle: 'Brand Management',
  syllabi: [{ fileName: 'MKT 4320 syllabus.pdf', text: SYLLABUS_TEXT }],
  assignmentsText: ASSIGNMENTS_TEXT,
  profile: PROFILE,
};

const reply = (data: unknown, cost = 500) => ({
  data, costUsdCents: cost, durationMs: 1, cachedTokens: 0, uncachedPromptTokens: 0, completionTokens: 0,
});

const GOOD = {
  intro: 'Intro.',
  objectives: [
    { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear',
      evidence: [{ assignment: 'Brand Audit', rubric_row: 'Research depth' }], gather: 'The distribution.', suggestion: null },
  ],
};
const BAD = {
  intro: 'Intro.',
  objectives: [
    { objective: 'Develop a brand strategy grounded in audience research.', measure: 'clear',
      evidence: [{ assignment: 'Capstone Pitch', rubric_row: null }], gather: 'The distribution.', suggestion: null },
  ],
};

beforeEach(() => {
  complete.mockReset();
  recordSpend.mockReset();
  recordSpend.mockResolvedValue(undefined);
});

describe('generateObjectiveGuide', () => {
  it('uses the objective-evidence-guide function and makes one call when the draft is clean', async () => {
    complete.mockResolvedValueOnce(reply(GOOD));
    const r = await generateObjectiveGuide(INPUT);
    expect(getProviderForFunction).toHaveBeenCalledWith('objective-evidence-guide');
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0]).toMatchObject({ systemPrompt: 'SYSTEM PROMPT', schemaName: 'objective_evidence_guide' });
    expect(r.attempts).toBe(1);
    expect(r.droppedNames).toEqual([]);
    expect(r.model).toBe('gpt-test');
    expect(r.guide.checklist).toEqual([{ assignment: 'Brand Audit', rubric_row: 'Research depth' }]);
    expect(recordSpend).toHaveBeenCalledWith(500);
    expect(r.costUsdCents).toBe(500);
  });

  it('retries once with the misses and the valid names, and keeps the corrected draft', async () => {
    complete.mockResolvedValueOnce(reply(BAD)).mockResolvedValueOnce(reply(GOOD, 700));
    const r = await generateObjectiveGuide(INPUT);
    expect(complete).toHaveBeenCalledTimes(2);
    const retryMessage = complete.mock.calls[1]![0].userMessage as string;
    expect(retryMessage).toContain('Corrections needed');
    expect(retryMessage).toContain('- assignment: Capstone Pitch');
    expect(retryMessage).toContain('- Brand Audit');
    expect(r.attempts).toBe(2);
    expect(r.droppedNames).toEqual([]);
    expect(r.guide.objectives[0]!.measure).toBe('clear');
    expect(r.costUsdCents).toBe(1200);
    expect(recordSpend).toHaveBeenCalledTimes(2);
  });

  it('drops what is still unmatched after the retry and records it', async () => {
    complete.mockResolvedValueOnce(reply(BAD)).mockResolvedValueOnce(reply(BAD));
    const r = await generateObjectiveGuide(INPUT);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(r.droppedNames).toEqual(['assignment: Capstone Pitch']);
    expect(r.guide.objectives[0]).toMatchObject({ measure: 'none', evidence: [] });
    expect(r.guide.checklist).toEqual([]);
  });
});

describe('buildGuideUserMessage', () => {
  it('carries the syllabus, the assignments, the valid names and the capture findings', () => {
    const msg = buildGuideUserMessage(INPUT, parseCanvasAssignmentNames(ASSIGNMENTS_TEXT));
    expect(msg).toContain('# Course: MKT 4320 Brand Management');
    expect(msg).toContain('### MKT 4320 syllabus.pdf');
    expect(msg).toContain('• Develop a brand strategy grounded in audience research.');
    expect(msg).toContain('## Brand Audit (50 pts)');
    expect(msg).toContain('- Final Brand Playbook\n  - rubric row: Visual system');
    expect(msg).toContain('- Builds audience-grounded brand strategy (K3 U2 D3)');
    expect(msg).toContain('  cited: "cite three sources"');
    expect(msg).toContain('- Builds audience-grounded brand strategy: 50 pts (100%)');
    expect(msg).toContain('- Objective 3 has no assessment.');
    expect(msg).toContain('- Catalog overstates presentation work.');
  });
});
