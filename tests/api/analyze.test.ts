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

  it('returns an AnalysisResult on valid input', async () => {
    const upstreamKud = { description: 'Upstream course', know: ['k'], understand: ['u'], do: ['d'] };
    const downstreamKud = { description: 'Downstream course', know: ['k'], understand: ['u'], do: ['d'] };
    const coverage = { scores: [
      { subCompetencyId: 'workflow-design', kudLevel: 'do', confidence: 'high', reasoning: 'The capstone project demonstrates Do-level workflow design as documented in the syllabus.' },
    ]};
    const prereqClaims = { claims: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', rationale: 'Downstream needs incoming workflow understanding.' },
    ]};
    const gaps = { gaps: [
      { subCompetencyId: 'workflow-design', expectedKudLevel: 'understand', status: 'met', upstreamEvidence: 'Upstream achieves Do level.', reasoning: 'Upstream exceeds the expected level so the prerequisite is met.' },
    ]};

    const fake = new FakeProvider([
      upstreamKud,           // call 1: draft outcomes for upstream
      downstreamKud,         // call 2: draft outcomes for downstream
      coverage,              // call 3: score upstream coverage
      coverage,              // call 4: score downstream coverage
      prereqClaims,          // call 5: suggest prereqs for downstream
      gaps,                  // call 6: analyze gaps
    ]);
    vi.spyOn(providerModule, 'getProvider').mockReturnValue(fake);

    const req = makeRequest({
      careerTargetId: 'production-operations',
      upstream: { courseLabel: 'GC 3460', syllabusText: 'Ink and substrates syllabus body here for testing purposes only.' },
      downstream: { courseLabel: 'GC 4060', syllabusText: 'Package and specialty printing syllabus body here for testing purposes only.' },
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.upstream.kud.description).toBe('Upstream course');
    expect(body.downstream.prerequisiteGaps[0].status).toBe('met');
    expect(body.meta.aiProvider).toBe('fake');
    expect(queriesModule.insertRun).toHaveBeenCalledOnce();
  });

  it('rejects with 400 when career target id is unknown', async () => {
    const req = makeRequest({
      careerTargetId: 'unknown-target',
      upstream: { syllabusText: 'x' },
      downstream: { syllabusText: 'y' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('rejects with 400 when a syllabus is missing or too short', async () => {
    const req = makeRequest({
      careerTargetId: 'production-operations',
      upstream: { syllabusText: '' },
      downstream: { syllabusText: 'y' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
