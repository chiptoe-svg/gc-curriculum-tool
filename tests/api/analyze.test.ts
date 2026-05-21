import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/analyze/route';
import { FakeProvider } from '@/lib/ai/fake-provider';
import * as providerModule from '@/lib/ai/provider';

vi.mock('@/lib/ai/analyze/guards', () => ({
  applyAnalyzeGuards: vi.fn().mockResolvedValue({ short: null, ipHash: 'test-hash' }),
}));
vi.mock('@/lib/ai/analyze/persist', () => ({
  persistAnalyzeRun: vi.fn().mockResolvedValue('fake-run-id'),
}));
vi.mock('@/lib/ai/analyze/resolve-course-context', () => ({
  resolveCourseContext: vi.fn((_label: string, fallback: string) => Promise.resolve(fallback)),
}));
vi.mock('@/lib/ai/prompts/load', () => ({
  loadPrompt: vi.fn().mockResolvedValue('PROMPT'),
}));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  });
}

const kudResponse = { description: 'Core threshold concept', know: ['k1'], understand: ['u1'], do: ['d1'] };
const prereqResponse = { prereqs: [{ id: 'prereq_workflow', name: 'Workflow Design', expectedKudLevel: 'understand', knowDescriptor: 'Can recall the basic steps.', understandDescriptor: 'Can explain why order matters.', doDescriptor: 'Can design a workflow independently.' }] };
const coverageResponse = { scores: [{ subCompetencyId: 'prereq_workflow', kudLevel: 'do', confidence: 'high', reasoning: 'The capstone project demonstrates Do-level workflow design in context.' }] };
const gapsResponse = { gaps: [{ subCompetencyId: 'prereq_workflow', expectedKudLevel: 'understand', status: 'met', priorCourseworkEvidence: 'GC 3460 achieves Do level workflow design.', reasoning: 'Prior coursework exceeds the expected level so the prerequisite is met.' }] };
const scaffoldingResponse = { scaffolding: [{ subCompetencyId: 'prereq_workflow', quality: 'strong', reasoning: 'Workflow scaffolds cleanly from prior coursework Do-level through this course.' }] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/analyze', () => {
  it('returns an AnalysisResult on valid input with 1 prior course', async () => {
    // N=1: [focal_kud, prior_kud, prereqs, prior_coverage, gaps, scaffolding] = 6 calls
    const fake = new FakeProvider([kudResponse, kudResponse, prereqResponse, coverageResponse, gapsResponse, scaffoldingResponse]);
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(fake);

    const req = makeRequest({
      course: { courseLabel: 'GC 4060', syllabusText: 'Package and specialty printing syllabus body here for testing purposes only.' },
      priorCoursework: [{ courseLabel: 'GC 3460', syllabusText: 'Ink and substrates syllabus body here for testing purposes only.' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priorCoursework).toHaveLength(1);
    expect(body.priorCoursework[0].courseLabel).toBe('GC 3460');
    expect(body.priorCoursework[0].kud.description).toBe('Core threshold concept');
    expect(body.course.courseLabel).toBe('GC 4060');
    expect(body.course.prerequisiteGaps[0].status).toBe('met');
    expect(body.meta.aiProvider).toBeDefined();
    expect(typeof body.meta.cachedTokens).toBe('number');
    expect(typeof body.meta.uncachedTokens).toBe('number');
    expect(typeof body.meta.completionTokens).toBe('number');
  });

  it('returns an AnalysisResult with 2 prior courses', async () => {
    // N=2: [focal_kud, prior0_kud, prior1_kud, prereqs, prior0_coverage, prior1_coverage, gaps, scaffolding] = 8 calls
    const fake = new FakeProvider([kudResponse, kudResponse, kudResponse, prereqResponse, coverageResponse, coverageResponse, gapsResponse, scaffoldingResponse]);
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(fake);

    const req = makeRequest({
      course: { courseLabel: 'GC 4060', syllabusText: 'Package and specialty printing syllabus body here for testing purposes only.' },
      priorCoursework: [
        { courseLabel: 'GC 1040', syllabusText: 'Introduction to printing syllabus body here for testing purposes only.' },
        { courseLabel: 'GC 3460', syllabusText: 'Ink and substrates syllabus body here for testing purposes only.' },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priorCoursework).toHaveLength(2);
    expect(body.priorCoursework[0].courseLabel).toBe('GC 1040');
    expect(body.priorCoursework[1].courseLabel).toBe('GC 3460');
    expect(body.course.courseLabel).toBe('GC 4060');
    expect(body.course.prerequisiteGaps[0].status).toBe('met');
  });

  it('rejects with 400 when priorCoursework is empty', async () => {
    const res = await POST(makeRequest({
      course: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
      priorCoursework: [],
    }));
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when priorCoursework is missing', async () => {
    const res = await POST(makeRequest({
      course: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
    }));
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when a syllabus is too short', async () => {
    const res = await POST(makeRequest({
      course: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
      priorCoursework: [{ courseLabel: 'GC 1040', syllabusText: 'too short' }],
    }));
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when courseLabel is missing', async () => {
    const res = await POST(makeRequest({
      course: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
      priorCoursework: [{ courseLabel: '', syllabusText: 'x'.repeat(50) }],
    }));
    expect(res.status).toBe(400);
  });
});
