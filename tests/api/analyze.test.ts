import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/analyze/route';
import { FakeProvider } from '@/lib/ai/fake-provider';
import * as providerModule from '@/lib/ai/provider';
import * as queriesModule from '@/lib/db/queries';
import { CAREER_TARGETS } from '@/lib/domain/seed-targets';

vi.mock('@/lib/db/queries', () => ({
  insertRun: vi.fn().mockResolvedValue({ id: 'fake-run-id' }),
}));

// Mock the DB-backed career targets queries so the analyze test doesn't need a real DB
vi.mock('@/lib/db/career-targets-queries', () => ({
  getTargetById: vi.fn(async (id: string) => {
    return CAREER_TARGETS.find((t) => t.id === id) ?? null;
  }),
  clearTargetCache: vi.fn(),
  listTargets: vi.fn(async () => CAREER_TARGETS),
}));
vi.mock('@/lib/rate-limit/ip-rate-limit', () => ({
  checkIpRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 9 }),
  MAX_PER_HOUR: 10,
}));
vi.mock('@/lib/rate-limit/daily-cap', () => ({
  checkDailyCap: vi.fn().mockResolvedValue({ ok: true, spentCents: 0 }),
  recordSpend: vi.fn().mockResolvedValue(undefined),
}));

function makeRequest(body: unknown): Request {
  return new Request('http://localhost:3000/api/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/analyze', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an AnalysisResult on valid input with 1 prior course', async () => {
    const priorKud = { description: 'Prior course', know: ['k'], understand: ['u'], do: ['d'] };
    const courseKud = { description: 'Course being analyzed', know: ['k'], understand: ['u'], do: ['d'] };
    const coverage = { scores: [
      { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'The capstone project demonstrates Do-level workflow design as documented in the syllabus.' },
    ]};
    const prereqClaims = { claims: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', rationale: 'Course needs incoming workflow understanding.' },
    ]};
    const gaps = { gaps: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', status: 'met', priorCourseworkEvidence: 'GC 3460 achieves Do level.', reasoning: 'Prior coursework exceeds the expected level so the prerequisite is met.' },
    ]};

    // With N=1 prior: 1 prior KUD + 1 course KUD + 1 prior coverage + 1 course coverage + 1 prereq + 1 gap = 6 calls
    const fake = new FakeProvider([
      priorKud,             // call 1: draft outcomes for priorCoursework[0]
      courseKud,            // call 2: draft outcomes for course
      coverage,             // call 3: score priorCoursework[0] coverage
      coverage,             // call 4: score course coverage
      prereqClaims,         // call 5: suggest prereqs for course
      gaps,                 // call 6: analyze gaps
    ]);
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(fake);

    const req = makeRequest({
      careerTargetId: 'production-operations',
      course: { courseLabel: 'GC 4060', syllabusText: 'Package and specialty printing syllabus body here for testing purposes only.' },
      priorCoursework: [{ courseLabel: 'GC 3460', syllabusText: 'Ink and substrates syllabus body here for testing purposes only.' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.priorCoursework).toHaveLength(1);
    expect(body.priorCoursework[0].courseLabel).toBe('GC 3460');
    expect(body.priorCoursework[0].kud.description).toBe('Prior course');
    expect(body.course.courseLabel).toBe('GC 4060');
    expect(body.course.prerequisiteGaps[0].status).toBe('met');
    expect(body.meta.aiProvider).toBe('fake');
    expect(body.meta.cachedTokens).toBe(0);
    expect(typeof body.meta.uncachedTokens).toBe('number');
    expect(typeof body.meta.completionTokens).toBe('number');
    expect(queriesModule.insertRun).toHaveBeenCalledOnce();
  });

  it('returns an AnalysisResult with 2 prior courses', async () => {
    const prior1Kud = { description: 'First prior course', know: ['k1'], understand: ['u1'], do: ['d1'] };
    const prior2Kud = { description: 'Second prior course', know: ['k2'], understand: ['u2'], do: ['d2'] };
    const courseKud = { description: 'Course being analyzed', know: ['k'], understand: ['u'], do: ['d'] };
    const coverage = { scores: [
      { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'Demonstrates Do-level workflow design.' },
    ]};
    const prereqClaims = { claims: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', rationale: 'Course needs incoming workflow understanding.' },
    ]};
    const gaps = { gaps: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', status: 'met', priorCourseworkEvidence: 'GC 1040 develops Know level; GC 3460 develops Do level.', reasoning: 'Prior coursework exceeds the expected level.' },
    ]};

    // With N=2 prior: 2 prior KUD + 1 course KUD + 2 prior coverage + 1 course coverage + 1 prereq + 1 gap = 8 calls
    const fake = new FakeProvider([
      prior1Kud,            // call 1: draft outcomes for priorCoursework[0]
      prior2Kud,            // call 2: draft outcomes for priorCoursework[1]
      courseKud,            // call 3: draft outcomes for course
      coverage,             // call 4: score priorCoursework[0] coverage
      coverage,             // call 5: score priorCoursework[1] coverage
      coverage,             // call 6: score course coverage
      prereqClaims,         // call 7: suggest prereqs for course
      gaps,                 // call 8: analyze gaps
    ]);
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(fake);

    const req = makeRequest({
      careerTargetId: 'production-operations',
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
    expect(body.priorCoursework[0].kud.description).toBe('First prior course');
    expect(body.priorCoursework[1].courseLabel).toBe('GC 3460');
    expect(body.priorCoursework[1].kud.description).toBe('Second prior course');
    expect(body.course.courseLabel).toBe('GC 4060');
    expect(body.course.prerequisiteGaps[0].status).toBe('met');
    expect(body.meta.aiProvider).toBe('fake');
    expect(body.meta.cachedTokens).toBe(0);
    expect(typeof body.meta.uncachedTokens).toBe('number');
    expect(typeof body.meta.completionTokens).toBe('number');
    expect(queriesModule.insertRun).toHaveBeenCalledOnce();
  });

  it('rejects with 400 when career target id is unknown', async () => {
    const req = makeRequest({
      careerTargetId: 'unknown-target',
      course: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
      priorCoursework: [{ courseLabel: 'GC 1040', syllabusText: 'x'.repeat(50) }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when priorCoursework is empty', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      course: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
      priorCoursework: [],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when priorCoursework is missing', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      course: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when a syllabus is too short', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      course: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
      priorCoursework: [{ courseLabel: 'GC 1040', syllabusText: 'too short' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when courseLabel is missing', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      course: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
      priorCoursework: [{ courseLabel: '', syllabusText: 'x'.repeat(50) }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
