import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '@/app/api/analyze/route';
import { FakeProvider } from '@/lib/ai/fake-provider';
import * as providerModule from '@/lib/ai/provider';
import * as queriesModule from '@/lib/db/queries';

vi.mock('@/lib/db/queries', () => ({
  insertRun: vi.fn().mockResolvedValue({ id: 'fake-run-id' }),
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

  it('returns an AnalysisResult on valid input with 1 upstream course', async () => {
    const upstreamKud = { description: 'Upstream course', know: ['k'], understand: ['u'], do: ['d'] };
    const downstreamKud = { description: 'Downstream course', know: ['k'], understand: ['u'], do: ['d'] };
    const coverage = { scores: [
      { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'The capstone project demonstrates Do-level workflow design as documented in the syllabus.' },
    ]};
    const prereqClaims = { claims: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', rationale: 'Downstream needs incoming workflow understanding.' },
    ]};
    const gaps = { gaps: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', status: 'met', upstreamEvidence: 'GC 3460 achieves Do level.', reasoning: 'Upstream exceeds the expected level so the prerequisite is met.' },
    ]};

    // With N=1 upstream: 1 upstream KUD + 1 downstream KUD + 1 upstream coverage + 1 downstream coverage + 1 prereq + 1 gap = 6 calls
    const fake = new FakeProvider([
      upstreamKud,           // call 1: draft outcomes for upstream[0]
      downstreamKud,         // call 2: draft outcomes for downstream
      coverage,              // call 3: score upstream[0] coverage
      coverage,              // call 4: score downstream coverage
      prereqClaims,          // call 5: suggest prereqs for downstream
      gaps,                  // call 6: analyze gaps
    ]);
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(fake);

    const req = makeRequest({
      careerTargetId: 'production-operations',
      upstreamChain: [{ courseLabel: 'GC 3460', syllabusText: 'Ink and substrates syllabus body here for testing purposes only.' }],
      downstream: { courseLabel: 'GC 4060', syllabusText: 'Package and specialty printing syllabus body here for testing purposes only.' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upstreamChain).toHaveLength(1);
    expect(body.upstreamChain[0].courseLabel).toBe('GC 3460');
    expect(body.upstreamChain[0].kud.description).toBe('Upstream course');
    expect(body.downstream.prerequisiteGaps[0].status).toBe('met');
    expect(body.meta.aiProvider).toBe('fake');
    expect(queriesModule.insertRun).toHaveBeenCalledOnce();
  });

  it('returns an AnalysisResult with 2 upstream courses in the chain', async () => {
    const upstream1Kud = { description: 'First upstream course', know: ['k1'], understand: ['u1'], do: ['d1'] };
    const upstream2Kud = { description: 'Second upstream course', know: ['k2'], understand: ['u2'], do: ['d2'] };
    const downstreamKud = { description: 'Downstream course', know: ['k'], understand: ['u'], do: ['d'] };
    const coverage = { scores: [
      { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'Demonstrates Do-level workflow design.' },
    ]};
    const prereqClaims = { claims: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', rationale: 'Downstream needs incoming workflow understanding.' },
    ]};
    const gaps = { gaps: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', status: 'met', upstreamEvidence: 'GC 1040 develops Know level; GC 3460 develops Do level.', reasoning: 'Chain exceeds the expected level.' },
    ]};

    // With N=2 upstream: 2 upstream KUD + 1 downstream KUD + 2 upstream coverage + 1 downstream coverage + 1 prereq + 1 gap = 8 calls
    const fake = new FakeProvider([
      upstream1Kud,          // call 1: draft outcomes for upstream[0]
      upstream2Kud,          // call 2: draft outcomes for upstream[1]
      downstreamKud,         // call 3: draft outcomes for downstream
      coverage,              // call 4: score upstream[0] coverage
      coverage,              // call 5: score upstream[1] coverage
      coverage,              // call 6: score downstream coverage
      prereqClaims,          // call 7: suggest prereqs for downstream
      gaps,                  // call 8: analyze gaps
    ]);
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(fake);

    const req = makeRequest({
      careerTargetId: 'production-operations',
      upstreamChain: [
        { courseLabel: 'GC 1040', syllabusText: 'Introduction to printing syllabus body here for testing purposes only.' },
        { courseLabel: 'GC 3460', syllabusText: 'Ink and substrates syllabus body here for testing purposes only.' },
      ],
      downstream: { courseLabel: 'GC 4060', syllabusText: 'Package and specialty printing syllabus body here for testing purposes only.' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upstreamChain).toHaveLength(2);
    expect(body.upstreamChain[0].courseLabel).toBe('GC 1040');
    expect(body.upstreamChain[0].kud.description).toBe('First upstream course');
    expect(body.upstreamChain[1].courseLabel).toBe('GC 3460');
    expect(body.upstreamChain[1].kud.description).toBe('Second upstream course');
    expect(body.downstream.prerequisiteGaps[0].status).toBe('met');
    expect(body.meta.aiProvider).toBe('fake');
    expect(queriesModule.insertRun).toHaveBeenCalledOnce();
  });

  it('rejects with 400 when career target id is unknown', async () => {
    const req = makeRequest({
      careerTargetId: 'unknown-target',
      upstreamChain: [{ courseLabel: 'GC 1040', syllabusText: 'x'.repeat(50) }],
      downstream: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when upstreamChain is empty', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      upstreamChain: [],
      downstream: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when upstreamChain is missing', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      downstream: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when a syllabus is too short', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      upstreamChain: [{ courseLabel: 'GC 1040', syllabusText: 'too short' }],
      downstream: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when courseLabel is missing', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      upstreamChain: [{ courseLabel: '', syllabusText: 'x'.repeat(50) }],
      downstream: { courseLabel: 'GC 4060', syllabusText: 'y'.repeat(50) },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
