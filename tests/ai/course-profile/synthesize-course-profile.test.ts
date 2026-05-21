import { describe, it, expect, vi, beforeEach } from 'vitest';

const { getProvider, loadPrompt } = vi.hoisted(() => ({
  getProvider: vi.fn(),
  loadPrompt: vi.fn(),
}));
vi.mock('@/lib/ai/provider', () => ({ getProvider }));
vi.mock('@/lib/ai/prompts/load', () => ({ loadPrompt }));

import { synthesizeCourseProfile } from '@/lib/ai/course-profile/synthesize-course-profile';

const fakeProfile = {
  summary: 'This course develops press-floor fluency.',
  learningObjectives: ['Operate an 8-color press through make-ready'],
  skills: ['Color management'],
  competencies: [
    {
      name: 'Press operation',
      description: 'Run a commercial press through make-ready.',
      level: 'developed',
      evidence: [{ fileName: 'rubric.pdf', quote: 'Student must complete a 10k-impression run.' }],
    },
  ],
  catalogDivergence: {
    reinforced: ['Color theory'],
    additions: ['Spectrophotometric measurement'],
    gaps: ['Bindery operations'],
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  loadPrompt.mockResolvedValue('SYNTHESIZE SYSTEM PROMPT');
  getProvider.mockReturnValue({
    name: 'openai',
    model: 'gpt-5.4-mini',
    complete: vi.fn().mockResolvedValue({
      data: fakeProfile,
      costUsdCents: 15,
      durationMs: 500,
      cachedTokens: 100,
      uncachedPromptTokens: 400,
      completionTokens: 200,
    }),
  });
});

const course = {
  code: 'GC 4060',
  title: 'Color Science and Management',
  level: 4,
  track: 'print',
  description: 'Advanced color management.',
  learningObjectives: ['Understand color theory'],
  skillsRequired: ['Color management'],
};

const findings = [
  {
    fileName: 'rubric.pdf',
    finding: {
      materialType: 'rubric',
      competencies: [
        { name: 'Color management', description: 'Hit delta-E.', evidenceQuotes: ['delta-E ≤ 2.0'] },
      ],
      skills: ['Spectrophotometry'],
      notes: '',
    },
  },
];

describe('synthesizeCourseProfile', () => {
  it('returns the parsed profile plus telemetry', async () => {
    const out = await synthesizeCourseProfile({ course, findings });
    expect(out.data.summary).toContain('press-floor fluency');
    expect(out.data.catalogDivergence.additions).toContain('Spectrophotometric measurement');
    expect(out.telemetry.costUsdCents).toBe(15);
  });

  it('passes course fields and findings into the user message', async () => {
    const completeMock = vi.fn().mockResolvedValue({
      data: fakeProfile,
      costUsdCents: 1,
      durationMs: 1,
      cachedTokens: 0,
      uncachedPromptTokens: 0,
      completionTokens: 0,
    });
    getProvider.mockReturnValue({ name: 'openai', model: 'gpt', complete: completeMock });

    await synthesizeCourseProfile({ course, findings });

    const arg = completeMock.mock.calls[0]?.[0];
    expect(arg.systemPrompt).toBe('SYNTHESIZE SYSTEM PROMPT');
    expect(arg.userMessage).toContain('GC 4060');
    expect(arg.userMessage).toContain('rubric.pdf');
    expect(arg.userMessage).toContain('delta-E ≤ 2.0');
    expect(arg.userMessage).toContain('Understand color theory');
  });

  it('uses the synthesize-course-profile prompt name', async () => {
    await synthesizeCourseProfile({ course, findings });
    expect(loadPrompt).toHaveBeenCalledWith('synthesize-course-profile');
  });
});
